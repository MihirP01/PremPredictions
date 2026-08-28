export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import {
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import {
  getPostgresGameData,
  PostgresRoomAccessError,
  requirePostgresRoomMember,
} from "@/lib/server/postgres-read-model";

export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const params = new URL(request.url).searchParams;
    const requested = canonicalRoomCode(params.get("roomCode"));
    const seasonKey = String(params.get("seasonKey") || "");
    const gameweek = Number(params.get("gameweek"));
    const includeChips = params.get("includeChips") !== "0";
    if (
      !isValidRoomCode(requested) ||
      !/^\d{4}$/.test(seasonKey) ||
      !Number.isInteger(gameweek) ||
      gameweek < 1 ||
      gameweek > 38
    ) {
      return NextResponse.json(
        { error: "Invalid game request" },
        { status: 400 },
      );
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const data = await getPostgresGameData(
      roomCode,
      seasonKey,
      gameweek,
      includeChips,
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Game data failed";
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: message }, { status: error.status });
    }
    if (error instanceof PostgresRoomAccessError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
