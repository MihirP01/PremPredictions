export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../../../../firebase-admin";
import { buildRoomPassword, verifyRoomPassword } from "@/lib/roomPassword";

type AccessBody = {
  action?: "join" | "create";
  roomCode?: string;
  uid?: string;
  displayName?: string;
  password?: string;
};

type RoomSettings = {
  hasPassword?: boolean;
};

type RoomDoc = {
  leaderUid?: string;
  settings?: RoomSettings;
};

type SecurityDoc = {
  passwordHash?: string;
  passwordSalt?: string;
};

function validRoomCode(code: string) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

function cleanDisplayName(name: string) {
  const n = name.trim();
  return n.length ? n.slice(0, 32) : "Player";
}

function cleanPassword(input: unknown) {
  return String(input || "").trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AccessBody;
    const action = String(body.action || "").toLowerCase();
    const roomCode = String(body.roomCode || "")
      .trim()
      .toUpperCase();
    const uid = String(body.uid || "").trim();
    const displayName = cleanDisplayName(String(body.displayName || ""));
    const password = cleanPassword(body.password);

    if (
      (action !== "join" && action !== "create") ||
      !validRoomCode(roomCode)
    ) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    if (!uid) {
      return NextResponse.json({ error: "Missing uid." }, { status: 400 });
    }

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const playerRef = adminDb.doc(`rooms/${roomCode}/players/${uid}`);
    const userRef = adminDb.doc(`users/${uid}`);
    const securityRef = adminDb.doc(`rooms/${roomCode}/private/security`);

    if (action === "create") {
      if (password && (password.length < 4 || password.length > 64)) {
        return NextResponse.json(
          { error: "Password must be 4 to 64 characters." },
          { status: 400 },
        );
      }

      await adminDb.runTransaction(async (tx) => {
        const roomSnap = await tx.get(roomRef);
        if (roomSnap.exists) throw new Error("ROOM_EXISTS");

        tx.set(roomRef, {
          leaderUid: uid,
          settings: {
            gameModeStyle: "sprint",
            sameResultLock: false,
            powerupsEnabled: false,
            themeAccent: "teal",
            hasPassword: !!password,
            updatedAt: FieldValue.serverTimestamp(),
          },
          createdAt: FieldValue.serverTimestamp(),
        });

        if (password) {
          const pass = buildRoomPassword(password);
          tx.set(securityRef, {
            passwordHash: pass.hash,
            passwordSalt: pass.salt,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
          });
        }

        tx.set(playerRef, {
          displayName,
          role: "leader",
          joinedAt: FieldValue.serverTimestamp(),
        });

        tx.set(
          userRef,
          { currentRoomCode: roomCode, displayName },
          { merge: true },
        );
      });

      return NextResponse.json({ ok: true, roomCode });
    }

    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const room = roomSnap.data() as RoomDoc;
    const securitySnap = await securityRef.get();
    if (securitySnap.exists) {
      const sec = securitySnap.data() as SecurityDoc;
      if (
        !password ||
        !sec.passwordHash ||
        !sec.passwordSalt ||
        !verifyRoomPassword(password, sec.passwordSalt, sec.passwordHash)
      ) {
        return NextResponse.json(
          { error: "Invalid room password." },
          { status: 403 },
        );
      }
    } else if (room.settings?.hasPassword) {
      return NextResponse.json(
        { error: "Invalid room password." },
        { status: 403 },
      );
    }

    const playerSnap = await playerRef.get();
    const existingRole = String(playerSnap.data()?.role || "").toLowerCase();
    const role = existingRole === "leader" ? "leader" : "member";

    await playerRef.set(
      {
        displayName,
        role,
        joinedAt: playerSnap.exists
          ? playerSnap.data()?.joinedAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await userRef.set(
      { currentRoomCode: roomCode, displayName },
      { merge: true },
    );

    return NextResponse.json({ ok: true, roomCode });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed room access.";
    if (msg === "ROOM_EXISTS") {
      return NextResponse.json(
        { error: "Room code already used." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
