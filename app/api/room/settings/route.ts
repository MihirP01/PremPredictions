export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

type RoomSettingsBody = {
  roomCode?: string;
  leaderUid?: string;
  sameResultLock?: boolean;
  powerupsEnabled?: boolean;
  leagueFairPlayEnabled?: boolean;
  themeAccent?: string;
  gameModeStyle?: "round_robin" | "sprint" | "captain" | "league";
};

type RoomDoc = {
  leaderUid?: string;
  settings?: {
    sameResultLock?: boolean;
    powerupsEnabled?: boolean;
    leagueFairPlayEnabled?: boolean;
    themeAccent?: string;
    gameModeStyle?: "round_robin" | "sprint" | "captain" | "league";
  };
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
    const powerupsEnabled = body.powerupsEnabled;
    const leagueFairPlayEnabled = body.leagueFairPlayEnabled;
    const themeAccent =
      typeof body.themeAccent === "string"
        ? body.themeAccent.trim().toLowerCase()
        : undefined;
    const gameModeStyle =
      typeof body.gameModeStyle === "string"
        ? body.gameModeStyle.trim().toLowerCase()
        : undefined;

    if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    if (!leaderUid) {
      return NextResponse.json({ error: "Missing leaderUid" }, { status: 400 });
    }
    if (
      typeof sameResultLock !== "boolean" &&
      typeof powerupsEnabled !== "boolean" &&
      typeof leagueFairPlayEnabled !== "boolean" &&
      typeof themeAccent !== "string" &&
      typeof gameModeStyle !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "Provide sameResultLock, powerupsEnabled, leagueFairPlayEnabled, themeAccent and/or gameModeStyle",
        },
        { status: 400 },
      );
    }
    if (themeAccent && !ALLOWED_THEME_ACCENTS.has(themeAccent)) {
      return NextResponse.json(
        { error: "Invalid themeAccent" },
        { status: 400 },
      );
    }
    if (
      gameModeStyle &&
      gameModeStyle !== "round_robin" &&
      gameModeStyle !== "sprint" &&
      gameModeStyle !== "captain" &&
      gameModeStyle !== "league"
    ) {
      return NextResponse.json(
        { error: "Invalid gameModeStyle" },
        { status: 400 },
      );
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

    const currentSettings = room.settings ?? {};
    let nextGameModeStyle: "round_robin" | "sprint" | "captain" | "league" =
      currentSettings.gameModeStyle || "round_robin";
    if (
      gameModeStyle === "round_robin" ||
      gameModeStyle === "sprint" ||
      gameModeStyle === "captain" ||
      gameModeStyle === "league"
    ) {
      nextGameModeStyle = gameModeStyle;
    }
    let nextSameResultLock =
      typeof sameResultLock === "boolean"
        ? sameResultLock
        : currentSettings.sameResultLock !== false;
    if (nextGameModeStyle === "sprint" || nextGameModeStyle === "league") {
      nextSameResultLock = false;
    }
    const nextPowerupsEnabled =
      nextGameModeStyle === "league"
        ? false
        : typeof powerupsEnabled === "boolean"
          ? powerupsEnabled
          : currentSettings.powerupsEnabled === true;
    const nextLeagueFairPlayEnabled =
      typeof leagueFairPlayEnabled === "boolean"
        ? leagueFairPlayEnabled
        : currentSettings.leagueFairPlayEnabled === true;

    const nextSettings: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    nextSettings.gameModeStyle = nextGameModeStyle;
    nextSettings.sameResultLock = nextSameResultLock;
    nextSettings.powerupsEnabled = nextPowerupsEnabled;
    nextSettings.leagueFairPlayEnabled = nextLeagueFairPlayEnabled;
    if (themeAccent) nextSettings.themeAccent = themeAccent;

    await roomRef.set({ settings: nextSettings }, { merge: true });

    return NextResponse.json({
      ok: true,
      sameResultLock: nextSameResultLock,
      powerupsEnabled: nextPowerupsEnabled,
      leagueFairPlayEnabled: nextLeagueFairPlayEnabled,
      gameModeStyle: nextGameModeStyle,
      themeAccent: themeAccent ?? undefined,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
