export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isValidRoomCode, normalizeRoomCode, roomCodeLookupCandidates } from "@/lib/roomCode";
import { buildRoomPassword, verifyRoomPassword } from "@/lib/roomPassword";
import {
  assertClaimedUid,
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  mirrorRoomAccessToPostgres,
  mirrorRoomSecurityToPostgres,
} from "@/lib/server/postgres-room-repository";
import {
  getPostgresRoomSummary,
  resolvePostgresRoomCode,
} from "@/lib/server/postgres-read-model";

function cleanName(value: unknown) {
  const name = String(value || "").trim();
  return name ? name.slice(0, 32) : "Player";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "join" | "create";
      roomCode?: string;
      uid?: string;
      displayName?: string;
      password?: string;
    };
    const user = await requireFirebaseUser(req);
    const action = String(body.action || "").toLowerCase();
    const requestedCode = normalizeRoomCode(body.roomCode);
    const uid = assertClaimedUid(user, body.uid);
    const displayName = cleanName(body.displayName);
    const password = String(body.password || "").trim();
    if (!isValidRoomCode(requestedCode) || (action !== "create" && action !== "join")) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    if (action === "create") {
      if (password && (password.length < 4 || password.length > 64)) {
        return NextResponse.json({ error: "Password must be 4 to 64 characters." }, { status: 400 });
      }
      const exists = await getPostgresPool().query(
        "SELECT 1 FROM rooms WHERE upper(code) = ANY($1::text[]) LIMIT 1",
        [roomCodeLookupCandidates(requestedCode)],
      );
      if (exists.rowCount) {
        return NextResponse.json({ error: "Room code already used." }, { status: 409 });
      }
      const roomCode = requestedCode;
      const settings = {
        gameModeStyle: "sprint",
        sameResultLock: false,
        powerupsEnabled: false,
        leagueFairPlayEnabled: false,
        themeAccent: "teal",
        hasPassword: Boolean(password),
      };
      await mirrorRoomAccessToPostgres({
        roomCode,
        uid,
        displayName,
        role: "leader",
        leaderUid: uid,
        settings,
      });
      if (password) {
        const secret = buildRoomPassword(password);
        await mirrorRoomSecurityToPostgres({
          roomCode,
          passwordHash: secret.hash,
          passwordSalt: secret.salt,
          updatedBy: uid,
        });
      }
      return NextResponse.json({ ok: true, roomCode: normalizeRoomCode(roomCode) });
    }

    const roomCode = await resolvePostgresRoomCode(requestedCode);
    if (!roomCode) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    const security = await getPostgresPool().query<{
      password_hash: string | null;
      password_salt: string | null;
    }>(
      `SELECT s.password_hash, s.password_salt
         FROM rooms r LEFT JOIN room_security s ON s.room_code = r.code
        WHERE r.code = $1 LIMIT 1`,
      [roomCode],
    );
    const secret = security.rows[0];
    if (!secret) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (
      secret.password_hash &&
      (!password ||
        !secret.password_salt ||
        !verifyRoomPassword(password, secret.password_salt, secret.password_hash))
    ) {
      return NextResponse.json({ error: "Invalid room password." }, { status: 403 });
    }
    const [room, membership] = await Promise.all([
      getPostgresRoomSummary(roomCode),
      getPostgresPool().query<{ role: string }>(
        "SELECT role FROM room_members WHERE upper(room_code) = $1 AND user_id = $2 LIMIT 1",
        [normalizeRoomCode(roomCode), uid],
      ),
    ]);
    const role = membership.rows[0]?.role === "leader" ? "leader" : "member";
    await mirrorRoomAccessToPostgres({
      roomCode,
      uid,
      displayName,
      role,
      leaderUid: room.leaderUid,
      settings: {
        ...room.settings,
        gameModeStyle: room.gameModeStyle,
        sameResultLock: !room.allowIdenticalPicks,
        powerupsEnabled: room.powerupsEnabled,
        leagueFairPlayEnabled: room.leagueFairPlayEnabled,
        themeAccent: room.themeAccent,
        hasPassword: room.hasPassword,
      },
      roomSourceData: room.sourceData,
    });
    return NextResponse.json({ ok: true, roomCode: normalizeRoomCode(roomCode) });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = (error as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json({ error: "Room code already used." }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed room access." },
      { status: 500 },
    );
  }
}
