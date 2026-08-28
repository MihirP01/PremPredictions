import "server-only";

import {
  normalizeRoomCode,
  roomCodeLookupCandidates,
} from "@/lib/roomCode";
import { getPostgresPool } from "@/lib/server/postgres";

type JsonRecord = Record<string, unknown>;

type RoomRow = {
  leader_uid: string;
  game_mode_style: string;
  same_result_lock: boolean;
  powerups_enabled: boolean;
  league_fair_play_enabled: boolean;
  theme_accent: string;
  has_password: boolean;
  settings: JsonRecord | null;
  source_data: JsonRecord | null;
};

export class PostgresRoomNotFoundError extends Error {}
export class PostgresRoomAccessError extends Error {}

export async function resolvePostgresRoomCode(code: unknown) {
  const candidates = roomCodeLookupCandidates(code);
  if (!candidates.length) return null;
  const preferred = normalizeRoomCode(code);
  const result = await getPostgresPool().query<{ code: string }>(
    `SELECT code
       FROM rooms
      WHERE upper(code) = ANY($1::text[])
      ORDER BY CASE WHEN upper(code) = $2 THEN 0 ELSE 1 END, code
      LIMIT 1`,
    [candidates, preferred],
  );
  return result.rows[0]?.code ?? null;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function gameMode(value: unknown) {
  const mode = String(value || "").toLowerCase();
  if (mode === "round_robin" || mode === "captain" || mode === "league") {
    return mode;
  }
  return "sprint" as const;
}

export async function requirePostgresRoomMember(roomCode: string, uid: string) {
  const resolved = await resolvePostgresRoomCode(roomCode);
  if (!resolved) {
    throw new PostgresRoomAccessError("You are not a member of this room");
  }
  const result = await getPostgresPool().query(
    `SELECT 1
       FROM room_members
      WHERE upper(room_code) = $1 AND user_id = $2
      LIMIT 1`,
    [resolved.toUpperCase(), uid],
  );
  if (!result.rowCount) {
    throw new PostgresRoomAccessError("You are not a member of this room");
  }
  return resolved;
}

export async function getPostgresRoomSummary(roomCode: string) {
  const resolved = await resolvePostgresRoomCode(roomCode);
  if (!resolved) throw new PostgresRoomNotFoundError("Room not found");
  const [roomResult, seasonsResult] = await Promise.all([
    getPostgresPool().query<RoomRow>(
      `SELECT leader_uid, game_mode_style, same_result_lock,
              powerups_enabled, league_fair_play_enabled, theme_accent,
              has_password, settings, source_data
         FROM rooms
        WHERE code = $1
        LIMIT 1`,
      [resolved],
    ),
    getPostgresPool().query<{ season_key: string }>(
      `SELECT season_key
         FROM seasons
        WHERE upper(room_code) = $1
        ORDER BY season_key DESC`,
      [resolved.toUpperCase()],
    ),
  ]);
  const row = roomResult.rows[0];
  if (!row) throw new PostgresRoomNotFoundError("Room not found");

  const settings = objectValue(row.settings);
  const sourceData = objectValue(row.source_data);
  const mode = gameMode(settings.gameModeStyle ?? row.game_mode_style);
  const sameResultLock =
    typeof settings.sameResultLock === "boolean"
      ? settings.sameResultLock
      : row.same_result_lock;

  return {
    code: resolved,
    leaderUid: row.leader_uid,
    gameModeStyle: mode,
    allowIdenticalPicks: mode === "sprint" || sameResultLock === false,
    powerupsEnabled:
      typeof settings.powerupsEnabled === "boolean"
        ? settings.powerupsEnabled
        : row.powerups_enabled,
    leagueFairPlayEnabled:
      typeof settings.leagueFairPlayEnabled === "boolean"
        ? settings.leagueFairPlayEnabled
        : row.league_fair_play_enabled,
    themeAccent: String(settings.themeAccent || row.theme_accent || "teal"),
    hasPassword:
      typeof settings.hasPassword === "boolean"
        ? settings.hasPassword
        : row.has_password,
    settings,
    sourceData,
    seasonOptions: seasonsResult.rows.map((season) => season.season_key),
  };
}

export async function getPostgresGameState(
  roomCode: string,
  seasonKey: string,
  gameweek: number,
): Promise<JsonRecord | null> {
  const result = await getPostgresPool().query<{
    state: string;
    game_mode_style: string | null;
    leader_uid: string | null;
    fixture_ids: number[] | null;
    data: JsonRecord | null;
  }>(
    `SELECT state, game_mode_style, leader_uid, fixture_ids, data
       FROM games
      WHERE upper(room_code) = $1 AND season_key = $2 AND gameweek = $3
      LIMIT 1`,
    [normalizeRoomCode(roomCode), seasonKey, gameweek],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...objectValue(row.data),
    state: row.state || "LOBBY",
    gameModeStyle: row.game_mode_style || undefined,
    leaderUid: row.leader_uid || undefined,
    fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids : [],
  };
}

export async function getPostgresRoomPlayers(roomCode: string) {
  const result = await getPostgresPool().query<{
    user_id: string;
    role: string;
    display_name: string | null;
    nickname: string | null;
    source_data: JsonRecord | null;
  }>(
    `SELECT user_id, role, display_name, nickname, source_data
       FROM room_members
      WHERE upper(room_code) = $1
      ORDER BY COALESCE(NULLIF(nickname, ''), display_name, user_id)`,
    [normalizeRoomCode(roomCode)],
  );
  return result.rows.map((row) => {
    const source = objectValue(row.source_data);
    return {
      uid: row.user_id,
      displayName: String(row.display_name || source.displayName || "Player"),
      nickName: String(row.nickname || source.nickName || ""),
      role: row.role === "leader" ? ("leader" as const) : ("member" as const),
    };
  });
}

export async function getPostgresGameData(
  roomCode: string,
  seasonKey: string,
  gameweek: number,
  includeChips: boolean,
) {
  const pool = getPostgresPool();
  const [picksResult, goldenResult, powerupsResult] = await Promise.all([
    pool.query<{
      user_id: string;
      fixture_id: number;
      score: string | null;
    }>(
      `SELECT user_id, fixture_id, score
         FROM predictions
        WHERE upper(room_code) = $1 AND season_key = $2 AND gameweek = $3`,
      [normalizeRoomCode(roomCode), seasonKey, gameweek],
    ),
    includeChips
      ? pool.query<{
          user_id: string;
          fixture_id: number | null;
          score: string | null;
          locked: boolean;
        }>(
          `SELECT user_id, fixture_id, score, locked
             FROM golden_picks
            WHERE upper(room_code) = $1 AND season_key = $2 AND gameweek = $3`,
          [normalizeRoomCode(roomCode), seasonKey, gameweek],
        )
      : Promise.resolve({ rows: [] }),
    includeChips
      ? pool.query<{
          user_id: string;
          fixture_id: number | null;
          powerup_type: string | null;
          locked: boolean;
        }>(
          `SELECT user_id, fixture_id, powerup_type, locked
             FROM powerups
            WHERE upper(room_code) = $1 AND season_key = $2 AND gameweek = $3`,
          [normalizeRoomCode(roomCode), seasonKey, gameweek],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    picks: picksResult.rows.map((row) => ({
      uid: row.user_id,
      fixtureId: Number(row.fixture_id),
      score: String(row.score || ""),
    })),
    goldens: goldenResult.rows
      .filter((row) => Number.isFinite(Number(row.fixture_id)))
      .map((row) => ({
        uid: row.user_id,
        fixtureId: Number(row.fixture_id),
        score: String(row.score || ""),
        locked: row.locked === true,
      })),
    powerups: powerupsResult.rows
      .filter(
        (row) =>
          Number.isFinite(Number(row.fixture_id)) &&
          (row.powerup_type === "ALL_IN" || row.powerup_type === "SAFETY_NET"),
      )
      .map((row) => ({
        uid: row.user_id,
        fixtureId: Number(row.fixture_id),
        powerupType: row.powerup_type as "ALL_IN" | "SAFETY_NET",
        locked: row.locked === true,
      })),
  };
}

export async function getPostgresSeasonScores(
  roomCode: string,
  seasonKey: string,
) {
  const [scoresResult, gamesResult] = await Promise.all([
    getPostgresPool().query<{
      gameweek: number;
      user_id: string;
      points: number;
      fair_play_bye: boolean;
      data: JsonRecord | null;
      updated_at: Date;
    }>(
      `SELECT gameweek, user_id, points, fair_play_bye, data, updated_at
         FROM weekly_scores
        WHERE upper(room_code) = $1 AND season_key = $2
        ORDER BY gameweek, user_id`,
      [normalizeRoomCode(roomCode), seasonKey],
    ),
    getPostgresPool().query<{ gameweek: number }>(
      `SELECT gameweek
         FROM games
        WHERE upper(room_code) = $1 AND season_key = $2
        ORDER BY gameweek`,
      [normalizeRoomCode(roomCode), seasonKey],
    ),
  ]);

  const weeks = new Map<
    number,
    { gw: number; computedAtMs: number | null; users: JsonRecord[] }
  >();
  for (const row of scoresResult.rows) {
    const data = objectValue(row.data);
    const existing = weeks.get(row.gameweek) ?? {
      gw: row.gameweek,
      computedAtMs: null,
      users: [],
    };
    const updatedAtMs = new Date(row.updated_at).getTime();
    if (Number.isFinite(updatedAtMs)) {
      existing.computedAtMs = Math.max(existing.computedAtMs ?? 0, updatedAtMs);
    }
    existing.users.push({
      ...data,
      uid: row.user_id,
      points: Number(row.points || 0),
      breakdown: objectValue(data.breakdown),
      scoreStatus:
        data.scoreStatus || (row.fair_play_bye ? "fair_play_bye" : "scored"),
      fairPlayApplied: row.fair_play_bye || data.fairPlayApplied === true,
      fairPlayMedian:
        data.fairPlayMedian == null ? null : Number(data.fairPlayMedian),
    });
    weeks.set(row.gameweek, existing);
  }

  return {
    roomCode,
    seasonKey,
    fetchedAtMs: Date.now(),
    weeks: [...weeks.values()].sort((a, b) => a.gw - b.gw),
    gameWeeks: gamesResult.rows.map((row) => Number(row.gameweek)),
  };
}
