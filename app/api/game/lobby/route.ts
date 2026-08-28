export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { resolveSeasonKey } from "@/app/api/season";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { requirePostgresRoomMember, PostgresRoomAccessError } from "@/lib/server/postgres-read-model";

function parse(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    roomCode: canonicalRoomCode(params.get("roomCode")),
    seasonKey: resolveSeasonKey(params.get("seasonKey")),
    gameweek: Number(params.get("gameweek")),
  };
}

function valid(roomCode: string, gameweek: number) {
  return isValidRoomCode(roomCode) && Number.isInteger(gameweek) && gameweek >= 1 && gameweek <= 38;
}

export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const { roomCode: requested, seasonKey, gameweek } = parse(request);
    if (!valid(requested, gameweek)) return NextResponse.json({ error: "Invalid lobby" }, { status: 400 });
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const result = await getPostgresPool().query<{
      user_id: string;
      display_name: string | null;
      nickname: string | null;
    }>(
      `SELECT l.user_id, m.display_name, m.nickname
         FROM game_lobby l
         JOIN room_members m ON m.room_code = l.room_code AND m.user_id = l.user_id
        WHERE l.room_code = $1 AND l.season_key = $2 AND l.gameweek = $3
          AND l.updated_at > now() - interval '45 seconds'
        ORDER BY COALESCE(NULLIF(m.nickname, ''), m.display_name, l.user_id)`,
      [roomCode, seasonKey, gameweek],
    );
    return NextResponse.json({
      players: result.rows.map((row) => ({
        uid: row.user_id,
        displayName: row.nickname || row.display_name || "Player",
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PostgresRoomAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Lobby load failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = (await request.json()) as {
      action?: "join" | "leave";
      roomCode?: string;
      seasonKey?: string;
      gameweek?: number;
      displayName?: string;
    };
    const requested = canonicalRoomCode(body.roomCode);
    const seasonKey = resolveSeasonKey(body.seasonKey);
    const gameweek = Number(body.gameweek);
    if (!valid(requested, gameweek)) return NextResponse.json({ error: "Invalid lobby" }, { status: 400 });
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    if (body.action === "leave") {
      await getPostgresPool().query(
        "DELETE FROM game_lobby WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 AND user_id = $4",
        [roomCode, seasonKey, gameweek, user.uid],
      );
    } else {
      await getPostgresPool().query(
        `INSERT INTO game_lobby (room_code, season_key, gameweek, user_id, ready, data, updated_at)
         VALUES ($1, $2, $3, $4, false, jsonb_build_object('displayName', $5::text), now())
         ON CONFLICT (room_code, season_key, gameweek, user_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [roomCode, seasonKey, gameweek, user.uid, String(body.displayName || "Player")],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PostgresRoomAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Lobby update failed" }, { status: 500 });
  }
}
