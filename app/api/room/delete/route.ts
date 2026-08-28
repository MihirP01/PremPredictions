export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import {
  assertClaimedUid,
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import { deletePostgresRoom } from "@/lib/server/postgres-room-repository";
import { getPostgresRoomSummary, PostgresRoomNotFoundError } from "@/lib/server/postgres-read-model";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { roomCode?: string; leaderUid?: string };
    const authenticatedUser = await requireFirebaseUser(req);
    const roomCode = canonicalRoomCode(body.roomCode);
    const leaderUid = assertClaimedUid(authenticatedUser, body.leaderUid);
    if (!isValidRoomCode(roomCode)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    const room = await getPostgresRoomSummary(roomCode);
    if (room.leaderUid !== leaderUid) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }
    await deletePostgresRoom(room.code);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostgresRoomNotFoundError) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "delete failed" },
      { status: 500 },
    );
  }
}
