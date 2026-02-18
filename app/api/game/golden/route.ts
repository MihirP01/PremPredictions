export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import {
  coerceMillis,
  getBaseUrl,
  loadGwFixturesWithLockWindow,
} from "../lock-window";
import { resolveSeasonKey } from "../../season";

type GoldenBody = {
  roomCode?: string;
  gw?: number;
  uid?: string;
  fixtureId?: number;
  score?: string;
  seasonKey?: string;
};

type GameDoc = {
  state?: string;
  players?: string[];
  lockAt?: unknown;
  firstKickoffAt?: unknown;
};

type PickDoc = {
  score?: string;
};

type GoldenDoc = {
  locked?: boolean;
};

export async function POST(req: Request) {
  try {
    const { roomCode, gw, uid, fixtureId, score, seasonKey } =
      (await req.json()) as GoldenBody;
    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    const userUid = String(uid || "");
    const fxId = Number(fixtureId);
    const sc = String(score || "").trim();
    const sk = resolveSeasonKey(seasonKey);

    if (!rc || !Number.isFinite(gwn) || !userUid)
      return NextResponse.json({ error: "Bad input" }, { status: 400 });

    const seasonBase = `rooms/${rc}/seasons/${sk}`;
    const gameRef = adminDb.doc(`${seasonBase}/games/gw-${gwn}`);
    const goldenRef = adminDb.doc(
      `${seasonBase}/games/gw-${gwn}/golden/${userUid}`,
    );
    const pickRef = adminDb.doc(
      `${seasonBase}/games/gw-${gwn}/picks/${userUid}_${fxId}`,
    );

    const preGameSnap = await gameRef.get();
    if (!preGameSnap.exists) {
      return NextResponse.json({ error: "Game missing" }, { status: 400 });
    }
    const preGame = preGameSnap.data() as GameDoc;
    let lockAtMs = coerceMillis(preGame.lockAt);
    if (lockAtMs == null) {
      const baseUrl = getBaseUrl(req);
      const { firstKickoffAt, lockAt } = await loadGwFixturesWithLockWindow(
        baseUrl,
        gwn,
        sk,
      );
      await gameRef.set({ firstKickoffAt, lockAt }, { merge: true });
      lockAtMs = lockAt.getTime();
    }

    if (lockAtMs != null && Date.now() >= lockAtMs) {
      return NextResponse.json(
        {
          error:
            "Mini-game is locked (deadline is 1 hour before first kickoff).",
        },
        { status: 409 },
      );
    }

    await adminDb.runTransaction(async (tx) => {
      // -------- READS FIRST --------
      const gameSnap = await tx.get(gameRef);
      if (!gameSnap.exists) throw new Error("Game missing");

      const game = gameSnap.data() as GameDoc;
      if (game.state !== "GOLDEN") throw new Error("Not in GOLDEN phase");

      const txLockAtMs = coerceMillis(game.lockAt) ?? lockAtMs;
      if (txLockAtMs != null && Date.now() >= txLockAtMs) {
        throw new Error(
          "Mini-game is locked (deadline is 1 hour before first kickoff).",
        );
      }

      const players: string[] = Array.isArray(game.players) ? game.players : [];
      if (players.length === 0) throw new Error("No players in game");

      const pickSnap = await tx.get(pickRef);
      if (!pickSnap.exists)
        throw new Error("You must choose golden from your own picks");
      const pick = pickSnap.data() as PickDoc;

      const pickScore = String(pick.score ?? "").trim();
      if (pickScore !== sc)
        throw new Error("Golden must match your pick score");

      const existingGoldenSnap = await tx.get(goldenRef);
      const existingGolden = existingGoldenSnap.exists
        ? (existingGoldenSnap.data() as GoldenDoc)
        : null;
      if (existingGolden?.locked) throw new Error("Golden already locked");

      // Read each player's golden doc (docId is their uid)
      const goldenRefs = players.map((puid) =>
        adminDb.doc(`${seasonBase}/games/gw-${gwn}/golden/${puid}`),
      );

      const goldenSnaps = goldenRefs.length
        ? await tx.getAll(...goldenRefs)
        : [];
      const lockedBefore = goldenSnaps.reduce((acc, s) => {
        const d = s.exists ? (s.data() as GoldenDoc) : null;
        return acc + (d?.locked ? 1 : 0);
      }, 0);

      // This request will lock the current user (we blocked already-locked above)
      const lockedAfter = lockedBefore + 1;

      // -------- WRITES AFTER --------
      tx.set(
        goldenRef,
        {
          uid: userUid,
          fixtureId: fxId,
          score: sc,
          createdAt: new Date(),
          locked: true,
        },
        { merge: true },
      );

      if (lockedAfter >= players.length) {
        tx.update(gameRef, { state: "REVEAL" });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "golden failed" },
      { status: 400 },
    );
  }
}
