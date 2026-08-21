export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveSeasonKey } from "../../season";
import { isValidRoomCode } from "@/lib/roomCode";
import { ensureLeagueDraftGame } from "../league-game";

type LeagueOpenBody = {
  roomCode?: string;
  gw?: number;
  uid?: string;
  seasonKey?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LeagueOpenBody;
    const roomCode = String(body.roomCode || "")
      .trim()
      .toUpperCase();
    const gw = Number(body.gw);
    const uid = String(body.uid || "").trim();
    const seasonKey = resolveSeasonKey(body.seasonKey);

    if (!isValidRoomCode(roomCode)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    if (!Number.isFinite(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    }
    if (!uid) {
      return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    }

    const opened = await ensureLeagueDraftGame({
      req,
      roomCode,
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
