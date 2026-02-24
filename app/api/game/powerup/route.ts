export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey } from "../../season";

type PowerupBody = {
  roomCode?: string;
  gw?: number;
  uid?: string;
  fixtureId?: number;
  powerupType?: "DOUBLE";
  seasonKey?: string;
};

type GameDoc = {
  state?: string;
  players?: string[];
  powerupsEnabled?: boolean;
};

type PickDoc = {
  score?: string;
};

type PowerupDoc = {
  locked?: boolean;
};

type GoldenDoc = {
  fixtureId?: number;
  locked?: boolean;
};

export async function POST(req: Request) {
  try {
    const { roomCode, gw, uid, fixtureId, powerupType, seasonKey } =
      (await req.json()) as PowerupBody;
    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    const userUid = String(uid || "");
    const fxId = Number(fixtureId);
    const type = String(powerupType || "DOUBLE").toUpperCase();
    const sk = resolveSeasonKey(seasonKey);

    if (!rc || !Number.isFinite(gwn) || !userUid || !Number.isFinite(fxId)) {
      return NextResponse.json({ error: "Bad input" }, { status: 400 });
    }
    if (type !== "DOUBLE") {
      return NextResponse.json({ error: "Unsupported power-up type" }, { status: 400 });
    }

    const seasonBase = `rooms/${rc}/seasons/${sk}`;
    const gameRef = adminDb.doc(`${seasonBase}/games/gw-${gwn}`);
    const powerupRef = adminDb.doc(`${seasonBase}/games/gw-${gwn}/powerups/${userUid}`);
    const pickRef = adminDb.doc(`${seasonBase}/games/gw-${gwn}/picks/${userUid}_${fxId}`);
    const goldenRef = adminDb.doc(`${seasonBase}/games/gw-${gwn}/golden/${userUid}`);

    const preGameSnap = await gameRef.get();
    if (!preGameSnap.exists) {
      return NextResponse.json({ error: "Game missing" }, { status: 400 });
    }

    await adminDb.runTransaction(async (tx) => {
      const gameSnap = await tx.get(gameRef);
      if (!gameSnap.exists) throw new Error("Game missing");

      const game = gameSnap.data() as GameDoc;
      if (game.state !== "POWERUPS") throw new Error("Not in POWERUPS phase");
      if (!game.powerupsEnabled) throw new Error("Power-ups are not enabled");

      const players: string[] = Array.isArray(game.players) ? game.players : [];
      if (players.length === 0) throw new Error("No players in game");

      const pickSnap = await tx.get(pickRef);
      if (!pickSnap.exists) {
        throw new Error("You can only place a power-up on your own pick");
      }
      const pick = pickSnap.data() as PickDoc;
      const pickScore = String(pick.score || "").trim();
      if (!pickScore) throw new Error("Invalid picked score");

      const goldenSnap = await tx.get(goldenRef);
      if (goldenSnap.exists) {
        const golden = goldenSnap.data() as GoldenDoc;
        const goldenFixtureId = Number(golden.fixtureId);
        if (golden.locked && Number.isFinite(goldenFixtureId) && goldenFixtureId === fxId) {
          throw new Error("Double Points cannot be used on your Golden fixture");
        }
      }

      const existingPowerupSnap = await tx.get(powerupRef);
      const existingPowerup = existingPowerupSnap.exists
        ? (existingPowerupSnap.data() as PowerupDoc)
        : null;
      if (existingPowerup?.locked) throw new Error("Power-up already locked");

      const powerupRefs = players.map((puid) =>
        adminDb.doc(`${seasonBase}/games/gw-${gwn}/powerups/${puid}`),
      );
      const powerupSnaps = powerupRefs.length ? await tx.getAll(...powerupRefs) : [];
      const lockedBefore = powerupSnaps.reduce((acc, s) => {
        const d = s.exists ? (s.data() as PowerupDoc) : null;
        return acc + (d?.locked ? 1 : 0);
      }, 0);

      tx.set(
        powerupRef,
        {
          uid: userUid,
          fixtureId: fxId,
          powerupType: "DOUBLE",
          score: pickScore,
          createdAt: new Date(),
          locked: true,
        },
        { merge: true },
      );

      if (lockedBefore + 1 >= players.length) {
        tx.update(gameRef, { state: "REVEAL" });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "powerup failed" },
      { status: 400 },
    );
  }
}
