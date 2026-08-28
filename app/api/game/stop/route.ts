export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveSeasonKey } from "../../season";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresGameState, getPostgresRoomSummary } from "@/lib/server/postgres-read-model";
import {
  clearPostgresGameSelections,
  mirrorGameStateToPostgres,
} from "@/lib/server/postgres-room-repository";

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
    const game = await getPostgresGameState(roomCode, seasonKey, gw);
    if (!game) return NextResponse.json({ error: "Game not started" }, { status: 404 });
    const state = String(game.state || "").toUpperCase();
    if (state === "LOBBY") return NextResponse.json({ ok: true, state });
    if (!["DRAFT", "GOLDEN", "POWERUPS", "REVEAL"].includes(state)) {
      return NextResponse.json({ error: `Cannot stop from state ${state || "UNKNOWN"}` }, { status: 400 });
    }
    if (game.gameModeStyle === "league") {
      return NextResponse.json(
        { error: "League predictions follow the gameweek lock and cannot be closed early." },
        { status: 400 },
      );
    }
    await clearPostgresGameSelections({ roomCode, seasonKey, gameweek: gw });
    const next: Record<string, unknown> = { ...game, state: "LOBBY", currentTurn: 0, draftReadyByUid: {}, stoppedBy: user.uid, stoppedAt: new Date().toISOString() };
    delete next.forcedReveal;
    await mirrorGameStateToPostgres({ roomCode, seasonKey, gameweek: gw, data: next });
    return NextResponse.json({ ok: true, state: "LOBBY" });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "stop failed" }, { status: 500 });
  }
}
