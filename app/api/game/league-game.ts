import { canonicalRoomCode } from "@/lib/roomCode";
import { getBaseUrl, loadGwFixturesWithLockWindow } from "./lock-window";
import { getPostgresPool } from "@/lib/server/postgres";
import { getPostgresGameState, getPostgresRoomSummary, requirePostgresRoomMember } from "@/lib/server/postgres-read-model";
import { mirrorGameStateToPostgres } from "@/lib/server/postgres-room-repository";

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export async function ensureLeagueDraftGame(opts: {
  req: Request;
  roomCode: string;
  gw: number;
  seasonKey: string;
  uid: string;
}) {
  const { req, gw, seasonKey, uid } = opts;
  const room = await getPostgresRoomSummary(opts.roomCode);
  const roomCode = room.code;
  if (room.gameModeStyle !== "league") throw new Error("This room is not in League mode");
  await requirePostgresRoomMember(roomCode, uid);
  const members = await getPostgresPool().query<{ user_id: string }>(
    "SELECT user_id FROM room_members WHERE upper(room_code) = $1 ORDER BY user_id",
    [canonicalRoomCode(roomCode)],
  );
  const roomPlayers = members.rows.map((row) => row.user_id);
  if (roomPlayers.length < 2) throw new Error("Need at least 2 room players to open League predictions");
  const loaded = await loadGwFixturesWithLockWindow(getBaseUrl(req), gw, seasonKey, { lockMode: "league" });
  if (Date.now() >= loaded.lockAt.getTime()) {
    throw new Error("League predictions lock 30 minutes before the first game of the gameweek.");
  }
  if (!loaded.fixtureIds.length) throw new Error("No eligible fixtures for this GW (played/postponed/cancelled).");

  const existing = await getPostgresGameState(roomCode, seasonKey, gw);
  const state = String(existing?.state || "LOBBY").toUpperCase();
  if (existing && existing.gameModeStyle === "league" && ["DRAFT", "LOBBY", "CLOSED"].includes(state)) {
    const players = [...new Set([
      ...(Array.isArray(existing.players) ? existing.players.map(String) : []),
      ...roomPlayers,
    ])];
    const order = [...new Set([
      ...(Array.isArray(existing.order) ? existing.order.map(String) : []),
      ...players,
    ])];
    await mirrorGameStateToPostgres({
      roomCode,
      seasonKey,
      gameweek: gw,
      data: {
        ...existing,
        state: "DRAFT",
        players,
        order,
        firstKickoffAt: loaded.firstKickoffAt.toISOString(),
        lockAt: loaded.lockAt.toISOString(),
        leagueFairPlayEnabled: room.leagueFairPlayEnabled,
        seasonKey,
      },
    });
  } else if (existing && state !== "LOBBY") {
    throw new Error("Game already started");
  } else {
    const order = shuffle(roomPlayers);
    await mirrorGameStateToPostgres({
      roomCode,
      seasonKey,
      gameweek: gw,
      data: {
        state: "DRAFT",
        leaderUid: room.leaderUid || uid,
        players: roomPlayers,
        order,
        fixtureIds: loaded.fixtureIds,
        currentFixtureId: null,
        currentTurn: 0,
        totalTurns: order.length * loaded.fixtureIds.length,
        draftMode: "parallel",
        sameResultLock: false,
        powerupsEnabled: false,
        gameModeStyle: "league",
        leagueFairPlayEnabled: room.leagueFairPlayEnabled,
        leagueSubmittedByUid: {},
        voidedFixtureIds: [],
        draftReadyByUid: {},
        firstKickoffAt: loaded.firstKickoffAt.toISOString(),
        lockAt: loaded.lockAt.toISOString(),
        seasonKey,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      },
    });
  }
  return { ok: true as const, lockAt: loaded.lockAt, firstKickoffAt: loaded.firstKickoffAt };
}
