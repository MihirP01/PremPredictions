export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { buildRoomPassword, verifyRoomPassword } from "@/lib/roomPassword";
import {
  assertClaimedUid,
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import { mirrorRoomSecurityToPostgres } from "@/lib/server/postgres-room-repository";
import { getPostgresPool } from "@/lib/server/postgres";
import { resolvePostgresRoomCode } from "@/lib/server/postgres-read-model";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      roomCode?: string;
      leaderUid?: string;
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };
    const user = await requireFirebaseUser(req);
    const requested = canonicalRoomCode(body.roomCode);
    const leaderUid = assertClaimedUid(user, body.leaderUid);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!isValidRoomCode(requested)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    if (newPassword.length < 4 || newPassword.length > 64) {
      return NextResponse.json({ error: "Password must be 4 to 64 characters." }, { status: 400 });
    }
    if (newPassword !== String(body.confirmPassword || "")) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }
    const roomCode = await resolvePostgresRoomCode(requested);
    if (!roomCode) return NextResponse.json({ error: "Room not found." }, { status: 404 });
    const result = await getPostgresPool().query<{
      leader_uid: string;
      password_hash: string | null;
      password_salt: string | null;
    }>(
      `SELECT r.leader_uid, s.password_hash, s.password_salt
         FROM rooms r
         LEFT JOIN room_security s ON s.room_code = r.code
        WHERE r.code = $1 LIMIT 1`,
      [roomCode],
    );
    const room = result.rows[0];
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
    if (room.leader_uid !== leaderUid) {
      return NextResponse.json({ error: "Not leader." }, { status: 403 });
    }
    if (
      room.password_hash &&
      (!currentPassword ||
        !room.password_salt ||
        !verifyRoomPassword(currentPassword, room.password_salt, room.password_hash))
    ) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
    }
    const next = buildRoomPassword(newPassword);
    await mirrorRoomSecurityToPostgres({
      roomCode,
      passwordHash: next.hash,
      passwordSalt: next.salt,
      updatedBy: leaderUid,
    });
    return NextResponse.json({ ok: true, hasPassword: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update password." },
      { status: 500 },
    );
  }
}
