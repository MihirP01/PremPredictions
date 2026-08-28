export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { getBaseUrl, loadGwFixturesWithLockWindow } from "../lock-window";
import { resolveSeasonKey } from "../../season";
import { ensureLeagueDraftGame } from "../league-game";
import { mirrorGameStateToPostgres } from "@/lib/server/postgres-room-repository";
import { getPostgresGameState, getPostgresRoomSummary } from "@/lib/server/postgres-read-model";
import { getPostgresPool } from "@/lib/server/postgres";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as { roomCode?: string; gw?: number; leaderUid?: string; seasonKey?: string };
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const seasonKey = resolveSeasonKey(body.seasonKey);
    if (!isValidRoomCode(requested) || !Number.isInteger(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Invalid game request" }, { status: 400 });
    }
    const room = await getPostgresRoomSummary(requested);
    const roomCode = room.code;
    if (room.leaderUid !== user.uid || (body.leaderUid && body.leaderUid !== user.uid)) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }
    if (room.gameModeStyle === "league") {
      await ensureLeagueDraftGame({ req, roomCode, gw, seasonKey, uid: user.uid });
      return NextResponse.json({ ok: true });
    }
    const existing = await getPostgresGameState(roomCode, seasonKey, gw);
    if (existing && String(existing.state || "LOBBY").toUpperCase() !== "LOBBY") {
      return NextResponse.json({ error: "Game already started" }, { status: 409 });
    }
    const [members, lobby] = await Promise.all([
      getPostgresPool().query<{ user_id: string }>(
        "SELECT user_id FROM room_members WHERE upper(room_code) = $1 ORDER BY user_id",
        [requested],
      ),
      getPostgresPool().query<{ user_id: string }>(
        `SELECT user_id FROM game_lobby
          WHERE upper(room_code) = $1 AND season_key = $2 AND gameweek = $3
            AND updated_at > now() - interval '45 seconds'`,
        [requested, seasonKey, gw],
      ),
    ]);
    const players = lobby.rows.map((row) => row.user_id);
    const memberIds = members.rows.map((row) => row.user_id);
    if (memberIds.length < 2) {
      return NextResponse.json({ error: "Need at least 2 room players to start" }, { status: 400 });
    }
    const lobbySet = new Set(players);
    if (players.length !== memberIds.length || !memberIds.every((uid) => lobbySet.has(uid))) {
      return NextResponse.json(
        { error: `All room players must join lobby before starting (${players.length}/${memberIds.length})` },
        { status: 400 },
      );
    }
    const loaded = await loadGwFixturesWithLockWindow(getBaseUrl(req), gw, seasonKey);
    if (Date.now() >= loaded.lockAt.getTime()) {
      return NextResponse.json(
        { error: "Mini-game is locked (deadline is 30 minutes before first kickoff)." },
        { status: 409 },
      );
    }
    const fixtureIds = loaded.fixtureIds.slice(0, 10);
    const order = shuffle(players);
    const sameResultLock = room.gameModeStyle === "sprint" ? false : !room.allowIdenticalPicks;
    const draftMode = room.gameModeStyle === "sprint" || (room.gameModeStyle === "captain" && !sameResultLock)
      ? "parallel"
      : "turn";
    await mirrorGameStateToPostgres({
      roomCode,
      seasonKey,
      gameweek: gw,
      data: {
        state: "DRAFT",
        leaderUid: user.uid,
        players,
        order,
        fixtureIds,
        currentFixtureId: null,
        currentTurn: 0,
        totalTurns: order.length * fixtureIds.length,
        draftMode,
        sameResultLock,
        powerupsEnabled: room.powerupsEnabled,
        gameModeStyle: room.gameModeStyle,
        leagueFairPlayEnabled: false,
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
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "start failed";
    return NextResponse.json({ error: message }, { status: message.startsWith("No ") ? 400 : 500 });
  }
}
