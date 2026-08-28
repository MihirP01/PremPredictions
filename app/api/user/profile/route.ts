export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { canonicalRoomCode } from "@/lib/roomCode";
import { resolvePostgresRoomCode } from "@/lib/server/postgres-read-model";

export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const requested = canonicalRoomCode(new URL(request.url).searchParams.get("roomCode"));
    const roomCode = requested ? await resolvePostgresRoomCode(requested) : "";
    const result = await getPostgresPool().query<{
      display_name: string | null;
      nickname: string | null;
    }>(
      `SELECT u.display_name, m.nickname
         FROM app_users u
         LEFT JOIN room_members m ON m.user_id = u.firebase_uid AND upper(m.room_code) = $2
        WHERE u.firebase_uid = $1 LIMIT 1`,
      [user.uid, roomCode ? canonicalRoomCode(roomCode) : null],
    );
    return NextResponse.json({
      displayName: result.rows[0]?.nickname || result.rows[0]?.display_name || user.name || "",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Profile load failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = (await request.json()) as {
      displayName?: string;
      currentRoomCode?: string | null;
    };
    const displayName = body.displayName == null
      ? null
      : String(body.displayName || "Player").trim().slice(0, 64);
    const requestedRoom = canonicalRoomCode(body.currentRoomCode);
    let currentRoomCode: string | null = null;
    if (requestedRoom) {
      const roomCode = await resolvePostgresRoomCode(requestedRoom);
      const membership = roomCode
        ? await getPostgresPool().query(
            "SELECT 1 FROM room_members WHERE upper(room_code) = $1 AND user_id = $2 LIMIT 1",
            [canonicalRoomCode(roomCode), user.uid],
          )
        : { rowCount: 0 };
      if (!membership.rowCount) {
        return NextResponse.json({ error: "You are not a member of this room" }, { status: 403 });
      }
      currentRoomCode = roomCode;
    }
    await getPostgresPool().query(
      `INSERT INTO app_users (firebase_uid, email, display_name, current_room_code, source_data, updated_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, now())
       ON CONFLICT (firebase_uid) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
         current_room_code = EXCLUDED.current_room_code,
         updated_at = now()`,
      [user.uid, user.email || null, displayName, currentRoomCode],
    );
    return NextResponse.json({ ok: true, displayName, currentRoomCode });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Profile update failed" }, { status: 500 });
  }
}
