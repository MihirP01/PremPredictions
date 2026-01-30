export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";

function scoreOk(s: string) {
  return /^\d+-\d+$/.test(s);
}

export async function POST(req: Request) {
  try {
    const { roomCode, gw, uid, score } = await req.json();
    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    const userUid = String(uid || "");
    const sc = String(score || "").trim();

    if (!rc) return NextResponse.json({ error: "Missing roomCode" }, { status: 400 });
    if (!Number.isFinite(gwn)) return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    if (!userUid) return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    if (!scoreOk(sc)) return NextResponse.json({ error: "Bad score" }, { status: 400 });

    const gameRef = adminDb.doc(`rooms/${rc}/games/gw-${gwn}`);
    const picksCol = adminDb.collection(`rooms/${rc}/games/gw-${gwn}/picks`);

    await adminDb.runTransaction(async (tx) => {
      const gameSnap = await tx.get(gameRef);
      if (!gameSnap.exists) throw new Error("Game not started");

      const game = gameSnap.data() as any;
      if (game.state !== "DRAFT") throw new Error("Game not in DRAFT");

      const order: string[] = game.order || [];
      const fixtureIds: number[] = game.fixtureIds || [];
      const currentTurn: number = Number(game.currentTurn ?? 0);
      const totalTurns: number = Number(game.totalTurns ?? order.length * fixtureIds.length);

      if (currentTurn >= totalTurns) throw new Error("Draft already complete");

      const playerIndex = currentTurn % order.length;
      const fixtureIndex = Math.floor(currentTurn / order.length);
      const currentUid = order[playerIndex];
      const fixtureId = fixtureIds[fixtureIndex];

      if (currentUid !== userUid) throw new Error("Not your turn");

      // uniqueness: check if score already taken for this fixture
      // We keep it transaction-safe by scanning matching docs in this transaction.
      // (For scale: you can add a dedicated "taken" doc per fixture+score.)
      const existingSnap = await tx.get(picksCol.where("fixtureId", "==", fixtureId).where("score", "==", sc));
      if (!existingSnap.empty) throw new Error("Score already taken for this fixture");

      const pickId = `${userUid}_${fixtureId}`;
      const pickRef = adminDb.doc(`rooms/${rc}/games/gw-${gwn}/picks/${pickId}`);

      tx.set(pickRef, {
        uid: userUid,
        fixtureId,
        score: sc,
        createdAt: new Date(),
      }, { merge: false });

      const nextTurn = currentTurn + 1;

      // Advance state when draft finishes
      if (nextTurn >= totalTurns) {
        tx.update(gameRef, { currentTurn: nextTurn, state: "GOLDEN" });
      } else {
        tx.update(gameRef, { currentTurn: nextTurn });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "pick failed" }, { status: 400 });
  }
}