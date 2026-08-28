export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { resolvePostgresRoomCode } from "@/lib/server/postgres-read-model";
import {
  removePostgresRoomMember,
  updatePostgresRoomMemberNickname,
} from "@/lib/server/postgres-room-repository";

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = (await request.json()) as {
      action?: "leave" | "kick" | "nickname";
      roomCode?: string;
      targetUid?: string;
      nextRoomCode?: string | null;
      nickname?: string;
    };
    const action = body.action;
    const requested = canonicalRoomCode(body.roomCode);
    if (!isValidRoomCode(requested) || !action || !["leave", "kick", "nickname"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const roomCode = await resolvePostgresRoomCode(requested);
    if (!roomCode) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const targetUid = action === "kick" ? String(body.targetUid || "") : user.uid;
    const result = await getPostgresPool().query<{ leader_uid: string; member: boolean }>(
      `SELECT r.leader_uid, EXISTS(
         SELECT 1 FROM room_members m WHERE m.room_code = r.code AND m.user_id = $2
       ) AS member
       FROM rooms r WHERE r.code = $1 LIMIT 1`,
      [roomCode, targetUid],
    );
    const room = result.rows[0];
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (action === "kick" && room.leader_uid !== user.uid) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }
    if (action === "kick" && targetUid === room.leader_uid) {
      return NextResponse.json({ error: "The room leader cannot be removed" }, { status: 400 });
    }
    if (!room.member) {
      return NextResponse.json({ error: "Player is not in this room" }, { status: 404 });
    }
    if (action === "nickname") {
      const nickname = String(body.nickname || "").trim();
      if (nickname.length > 20) {
        return NextResponse.json({ error: "Nickname must be 20 characters or less" }, { status: 400 });
      }
      await updatePostgresRoomMemberNickname(roomCode, user.uid, nickname);
      return NextResponse.json({ ok: true, nickname });
    }
    const requestedNextRoom = canonicalRoomCode(body.nextRoomCode);
    const nextStored = requestedNextRoom
      ? await resolvePostgresRoomCode(requestedNextRoom)
      : null;
    const nextMembership = nextStored
      ? await getPostgresPool().query(
          `SELECT 1 FROM room_members WHERE upper(room_code) = $1 AND user_id = $2 LIMIT 1`,
          [canonicalRoomCode(nextStored), targetUid],
        )
      : null;
    const nextRoomCode =
      nextMembership?.rowCount && nextStored ? nextStored : "";
    await removePostgresRoomMember(roomCode, targetUid, nextRoomCode);
    return NextResponse.json({ ok: true, nextRoomCode: nextRoomCode || null });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Member update failed" },
      { status: 500 },
    );
  }
}
