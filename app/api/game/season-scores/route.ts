export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import {
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import {
  getPostgresSeasonScores,
  PostgresRoomAccessError,
  requirePostgresRoomMember,
} from "@/lib/server/postgres-read-model";

export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const params = new URL(request.url).searchParams;
    const requested = canonicalRoomCode(params.get("roomCode"));
    const seasonKey = String(params.get("seasonKey") || "");
    if (!isValidRoomCode(requested) || !/^\d{4}$/.test(seasonKey)) {
      return NextResponse.json(
        { error: "Invalid season request" },
        { status: 400 },
      );
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const snapshot = await getPostgresSeasonScores(roomCode, seasonKey);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scores failed";
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: message }, { status: error.status });
    }
    if (error instanceof PostgresRoomAccessError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
