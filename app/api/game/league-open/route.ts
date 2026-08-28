export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveSeasonKey } from "../../season";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { ensureLeagueDraftGame } from "../league-game";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";

type LeagueOpenBody = {
  roomCode?: string;
  gw?: number;
  uid?: string;
  seasonKey?: string;
};

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as LeagueOpenBody;
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const uid = user.uid;
    const seasonKey = resolveSeasonKey(body.seasonKey);

    if (!isValidRoomCode(requested)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    if (!Number.isFinite(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    }
    if (body.uid && body.uid !== uid) {
      return NextResponse.json({ error: "User identity does not match session" }, { status: 401 });
    }

    const opened = await ensureLeagueDraftGame({
      req,
      roomCode: requested,
      gw,
      seasonKey,
      uid,
    });

    return NextResponse.json({
      ok: true,
      lockAt: opened.lockAt.toISOString(),
      firstKickoffAt: opened.firstKickoffAt.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to open League predictions";
    const status =
      message === "Room not found"
        ? 404
        : message === "This room is not in League mode"
          ? 400
          : message === "You are not in this room"
            ? 403
            : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
