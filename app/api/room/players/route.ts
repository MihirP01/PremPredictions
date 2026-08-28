export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import {
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import {
  getPostgresRoomPlayers,
  PostgresRoomAccessError,
  requirePostgresRoomMember,
} from "@/lib/server/postgres-read-model";

export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const requested = canonicalRoomCode(
      new URL(request.url).searchParams.get("roomCode"),
    );
    if (!isValidRoomCode(requested)) {
      return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const players = await getPostgresRoomPlayers(roomCode);
    return NextResponse.json(
      { players },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Players failed";
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: message }, { status: error.status });
    }
    if (error instanceof PostgresRoomAccessError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
