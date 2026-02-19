export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

type RoomSettingsBody = {
  roomCode?: string;
  leaderUid?: string;
  sameResultLock?: boolean;
  themeAccent?: string;
};

type RoomDoc = {
  leaderUid?: string;
};

const ALLOWED_THEME_ACCENTS = new Set([
  "teal",
  "blue",
  "emerald",
  "orange",
  "rose",
  "red",
  "slate",
]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RoomSettingsBody;
    const roomCode = String(body.roomCode || "").toUpperCase();
    const leaderUid = String(body.leaderUid || "");
    const sameResultLock = body.sameResultLock;
    const themeAccent =
      typeof body.themeAccent === "string" ? body.themeAccent.trim().toLowerCase() : undefined;

    if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    if (!leaderUid) {
      return NextResponse.json({ error: "Missing leaderUid" }, { status: 400 });
    }
    if (typeof sameResultLock !== "boolean" && typeof themeAccent !== "string") {
      return NextResponse.json(
        { error: "Provide sameResultLock and/or themeAccent" },
        { status: 400 },
      );
    }
    if (themeAccent && !ALLOWED_THEME_ACCENTS.has(themeAccent)) {
      return NextResponse.json({ error: "Invalid themeAccent" }, { status: 400 });
    }

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const room = roomSnap.data() as RoomDoc;
    if (room.leaderUid !== leaderUid) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }

    const nextSettings: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof sameResultLock === "boolean") nextSettings.sameResultLock = sameResultLock;
    if (themeAccent) nextSettings.themeAccent = themeAccent;

    await roomRef.set({ settings: nextSettings }, { merge: true });

    return NextResponse.json({
      ok: true,
      sameResultLock:
        typeof sameResultLock === "boolean" ? sameResultLock : undefined,
      themeAccent: themeAccent ?? undefined,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
