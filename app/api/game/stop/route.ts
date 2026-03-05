export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { resolveSeasonKey } from "../../season";

type StopBody = {
  roomCode?: string;
  gw?: number;
  leaderUid?: string;
  seasonKey?: string;
};

type RoomDoc = {
  leaderUid?: string;
};

type GameDoc = {
  state?: string;
};

function onlyAlnum(s: string) {
  return /^[A-Z0-9]{4,8}$/.test(s);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StopBody;
    const roomCode = String(body.roomCode || "").toUpperCase();
    const gw = Number(body.gw);
    const leaderUid = String(body.leaderUid || "");
    const seasonKey = resolveSeasonKey(body.seasonKey);

    if (!onlyAlnum(roomCode))
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    if (!Number.isFinite(gw) || gw < 1 || gw > 38)
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    if (!leaderUid)
      return NextResponse.json({ error: "Missing leaderUid" }, { status: 400 });

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists)
      return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const room = roomSnap.data() as RoomDoc;
    if (room.leaderUid !== leaderUid)
      return NextResponse.json({ error: "Not leader" }, { status: 403 });

    const gameRef = adminDb.doc(
      `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}`,
    );
    const gameSnap = await gameRef.get();
    if (!gameSnap.exists) {
      return NextResponse.json({ error: "Game not started" }, { status: 404 });
    }

    const game = gameSnap.data() as GameDoc;
    const state = String(game.state || "").toUpperCase();
    if (state === "LOBBY") {
      return NextResponse.json({ ok: true, state });
    }
    if (
      state !== "DRAFT" &&
      state !== "GOLDEN" &&
      state !== "POWERUPS" &&
      state !== "REVEAL"
    ) {
      return NextResponse.json(
        { error: `Cannot stop from state ${state || "UNKNOWN"}` },
        { status: 400 },
      );
    }
    const picksCol = adminDb.collection(
      `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}/picks`,
    );
    const goldenCol = adminDb.collection(
      `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}/golden`,
    );
    const powerupsCol = adminDb.collection(
      `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}/powerups`,
    );
    const [picksSnap, goldenSnap, powerupsSnap] = await Promise.all([
      picksCol.get(),
      goldenCol.get(),
      powerupsCol.get(),
    ]);
    const batch = adminDb.batch();
    picksSnap.docs.forEach((d) => batch.delete(d.ref));
    goldenSnap.docs.forEach((d) => batch.delete(d.ref));
    powerupsSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    await gameRef.set(
      {
        state: "LOBBY",
        currentTurn: 0,
        draftReadyByUid: {},
        forcedReveal: FieldValue.delete(),
        stoppedBy: leaderUid,
        stoppedAt: new Date(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, state: "LOBBY" });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stop failed" },
      { status: 500 },
    );
  }
}
