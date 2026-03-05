export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../../../../firebase-admin";
import { buildRoomPassword, verifyRoomPassword } from "@/lib/roomPassword";

type PasswordBody = {
  roomCode?: string;
  leaderUid?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

type RoomDoc = {
  leaderUid?: string;
  settings?: { hasPassword?: boolean };
};

type SecurityDoc = {
  passwordHash?: string;
  passwordSalt?: string;
};

function validRoomCode(code: string) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PasswordBody;
    const roomCode = String(body.roomCode || "")
      .trim()
      .toUpperCase();
    const leaderUid = String(body.leaderUid || "").trim();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!validRoomCode(roomCode) || !leaderUid) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    if (newPassword.length < 4 || newPassword.length > 64) {
      return NextResponse.json(
        { error: "Password must be 4 to 64 characters." },
        { status: 400 },
      );
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match." },
        { status: 400 },
      );
    }

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const securityRef = adminDb.doc(`rooms/${roomCode}/private/security`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    const room = roomSnap.data() as RoomDoc;
    if (room.leaderUid !== leaderUid) {
      return NextResponse.json({ error: "Not leader." }, { status: 403 });
    }

    const securitySnap = await securityRef.get();
    if (securitySnap.exists) {
      const sec = securitySnap.data() as SecurityDoc;
      if (
        !currentPassword ||
        !sec.passwordHash ||
        !sec.passwordSalt ||
        !verifyRoomPassword(currentPassword, sec.passwordSalt, sec.passwordHash)
      ) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 403 },
        );
      }
    }

    const next = buildRoomPassword(newPassword);
    await securityRef.set(
      {
        passwordHash: next.hash,
        passwordSalt: next.salt,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: leaderUid,
      },
      { merge: true },
    );

    await roomRef.set(
      {
        settings: {
          hasPassword: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, hasPassword: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update password.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
