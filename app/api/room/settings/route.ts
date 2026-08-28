export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import {
  assertClaimedUid,
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import { mirrorRoomSettingsToPostgres } from "@/lib/server/postgres-room-repository";
import { getPostgresRoomSummary, PostgresRoomNotFoundError } from "@/lib/server/postgres-read-model";

const ACCENTS = new Set(["teal", "blue", "emerald", "orange", "rose", "red", "slate"]);
const MODES = new Set(["round_robin", "sprint", "captain", "league"]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      roomCode?: string;
      leaderUid?: string;
      sameResultLock?: boolean;
      powerupsEnabled?: boolean;
      leagueFairPlayEnabled?: boolean;
      themeAccent?: string;
      gameModeStyle?: "round_robin" | "sprint" | "captain" | "league";
    };
    const user = await requireFirebaseUser(req);
    const requested = canonicalRoomCode(body.roomCode);
    const leaderUid = assertClaimedUid(user, body.leaderUid);
    if (!isValidRoomCode(requested)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    const room = await getPostgresRoomSummary(requested);
    const roomCode = room.code;
    if (room.leaderUid !== leaderUid) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }
    const themeAccent = body.themeAccent?.trim().toLowerCase();
    const requestedMode = body.gameModeStyle?.trim().toLowerCase();
    if (themeAccent && !ACCENTS.has(themeAccent)) {
      return NextResponse.json({ error: "Invalid themeAccent" }, { status: 400 });
    }
    if (requestedMode && !MODES.has(requestedMode)) {
      return NextResponse.json({ error: "Invalid gameModeStyle" }, { status: 400 });
    }
    const gameModeStyle = (requestedMode || room.gameModeStyle) as
      | "round_robin"
      | "sprint"
      | "captain"
      | "league";
    const sameResultLock =
      gameModeStyle === "sprint" || gameModeStyle === "league"
        ? false
        : typeof body.sameResultLock === "boolean"
          ? body.sameResultLock
          : !room.allowIdenticalPicks;
    const powerupsEnabled =
      gameModeStyle === "league"
        ? false
        : typeof body.powerupsEnabled === "boolean"
          ? body.powerupsEnabled
          : room.powerupsEnabled;
    const leagueFairPlayEnabled =
      typeof body.leagueFairPlayEnabled === "boolean"
        ? body.leagueFairPlayEnabled
        : room.leagueFairPlayEnabled;
    const nextSettings = {
      ...room.settings,
      gameModeStyle,
      sameResultLock,
      powerupsEnabled,
      leagueFairPlayEnabled,
      themeAccent: themeAccent || room.themeAccent,
      hasPassword: room.hasPassword,
      updatedAt: new Date().toISOString(),
    };
    await mirrorRoomSettingsToPostgres(roomCode, nextSettings);
    return NextResponse.json({ ok: true, ...nextSettings });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostgresRoomNotFoundError) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "settings update failed" },
      { status: 500 },
    );
  }
}
