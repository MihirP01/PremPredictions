export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";

export async function POST(req: Request) {
  try {
    const { roomCode, gw, uid, fixtureId, score } = await req.json();
    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    const userUid = String(uid || "");
    const fxId = Number(fixtureId);
    const sc = String(score || "").trim();

    if (!rc || !Number.isFinite(gwn) || !userUid) return NextResponse.json({ error: "Bad input" }, { status: 400 });

    const gameRef = adminDb.doc(`rooms/${rc}/games/gw-${gwn}`);
    const goldenRef = adminDb.doc(`rooms/${rc}/games/gw-${gwn}/golden/${userUid}`);
    const pickRef = adminDb.doc(`rooms/${rc}/games/gw-${gwn}/picks/${userUid}_${fxId}`);

    await adminDb.runTransaction(async (tx) => {
  // -------- READS FIRST --------
  const gameSnap = await tx.get(gameRef);
  if (!gameSnap.exists) throw new Error("Game missing");

  const game = gameSnap.data() as any;
  if (game.state !== "GOLDEN") throw new Error("Not in GOLDEN phase");

  const players: string[] = Array.isArray(game.players) ? game.players : [];
  if (players.length === 0) throw new Error("No players in game");

  const pickSnap = await tx.get(pickRef);
  if (!pickSnap.exists) throw new Error("You must choose golden from your own picks");
  const pick = pickSnap.data() as any;

  const pickScore = String(pick.score ?? "").trim();
  if (pickScore !== sc) throw new Error("Golden must match your pick score");

  const existingGoldenSnap = await tx.get(goldenRef);
  const existingGolden = existingGoldenSnap.exists ? (existingGoldenSnap.data() as any) : null;
  if (existingGolden?.locked) throw new Error("Golden already locked");

  // Read each player's golden doc (docId is their uid)
  const goldenRefs = players.map((puid) =>
    adminDb.doc(`rooms/${rc}/games/gw-${gwn}/golden/${puid}`)
  );

  const goldenSnaps = goldenRefs.length ? await tx.getAll(...goldenRefs) : [];
  const lockedBefore = goldenSnaps.reduce((acc, s) => {
    const d = s.exists ? (s.data() as any) : null;
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
    { merge: true }
  );

  if (lockedAfter >= players.length) {
    tx.update(gameRef, { state: "REVEAL" });
  }
});

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "golden failed" }, { status: 400 });
  }
}