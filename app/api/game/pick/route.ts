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

type PickBody = {
  roomCode?: string;
  gw?: number;
  uid?: string;
  score?: string;
  fixtureId?: number;
  seasonKey?: string;
};

type GameDoc = {
  state?: string;
  order?: string[];
  fixtureIds?: number[];
  currentTurn?: number;
  totalTurns?: number;
  draftMode?: "turn" | "parallel";
  sameResultLock?: boolean;
  draftReadyByUid?: Record<string, boolean>;
  lockAt?: unknown;
  firstKickoffAt?: unknown;
};
type RoomDoc = {
  settings?: {
    sameResultLock?: boolean;
  };
};

function scoreOk(s: string) {
  return /^\d+-\d+$/.test(s);
}

export async function POST(req: Request) {
  try {
    const { roomCode, gw, uid, score, fixtureId, seasonKey } = (await req.json()) as PickBody;

    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    const userUid = String(uid || "");
    const sc = String(score || "").trim();
    const reqFixtureId = Number(fixtureId);
    const sk = resolveSeasonKey(seasonKey);

    if (!rc)
      return NextResponse.json({ error: "Missing roomCode" }, { status: 400 });
    if (!Number.isFinite(gwn) || gwn < 1 || gwn > 38)
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    if (!userUid)
      return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    if (!scoreOk(sc))
      return NextResponse.json({ error: "Bad score" }, { status: 400 });

    const seasonBase = `rooms/${rc}/seasons/${sk}`;
    const roomRef = adminDb.doc(`rooms/${rc}`);
    const gameRef = adminDb.doc(`${seasonBase}/games/gw-${gwn}`);
    const picksCol = adminDb.collection(`${seasonBase}/games/gw-${gwn}/picks`);

    const preGameSnap = await gameRef.get();
    if (!preGameSnap.exists) {
      return NextResponse.json({ error: "Game not started" }, { status: 400 });
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
      if (!gameSnap.exists) throw new Error("Game not started");
      const roomSnap = await tx.get(roomRef);

      const game = gameSnap.data() as GameDoc;
      if (game.state !== "DRAFT") throw new Error("Game not in DRAFT");
      const gameSameResultLock = (game as GameDoc).sameResultLock;
      const sameResultLock =
        typeof gameSameResultLock === "boolean"
          ? gameSameResultLock
          : (roomSnap.data() as RoomDoc | undefined)?.settings?.sameResultLock !==
            false;

      const txLockAtMs = coerceMillis(game.lockAt) ?? lockAtMs;
      if (txLockAtMs != null && Date.now() >= txLockAtMs) {
        throw new Error(
          "Mini-game is locked (deadline is 1 hour before first kickoff).",
        );
      }

      const order: string[] = Array.isArray(game.order) ? game.order : [];
      const fixtureIds: number[] = Array.isArray(game.fixtureIds)
        ? game.fixtureIds
        : [];
      const currentTurn: number = Number(game.currentTurn ?? 0);
      const draftMode: "turn" | "parallel" = sameResultLock ? "turn" : "parallel";
      const readyByUid: Record<string, boolean> = {
        ...(game.draftReadyByUid ?? {}),
      };

      if (!order.length) throw new Error("No players in order");
      if (!fixtureIds.length) throw new Error("No fixtures");

      const P = order.length;
      const totalTurns: number = Number(
        game.totalTurns ?? P * fixtureIds.length,
      );
      let myPickCountBeforeWrite = 0;

      let fixtureIdToPick: number;
      if (draftMode === "parallel") {
        if (!Number.isFinite(reqFixtureId))
          throw new Error("Missing fixtureId");
        fixtureIdToPick = reqFixtureId;
        if (!fixtureIds.includes(fixtureIdToPick))
          throw new Error("Fixture not part of this game");
      } else {
        if (currentTurn >= totalTurns) throw new Error("Draft already complete");

        const fixtureIndex = Math.floor(currentTurn / P);
        if (fixtureIndex >= fixtureIds.length)
          throw new Error("Draft already complete");

        const turnInFixture = currentTurn % P;
        const rotatedIndex = (turnInFixture + fixtureIndex) % P;
        const currentUid = order[rotatedIndex];
        fixtureIdToPick = fixtureIds[fixtureIndex];

        if (currentUid !== userUid) throw new Error("Not your turn");
      }

      // Uniqueness: score can't be taken twice for same fixture
      // (Transaction-safe, OK for your scale)
      if (sameResultLock) {
        const existingSnap = await tx.get(
          picksCol.where("fixtureId", "==", fixtureIdToPick).where("score", "==", sc),
        );
        if (!existingSnap.empty)
          throw new Error("Score already taken for this fixture");
      }

      const pickId = `${userUid}_${fixtureIdToPick}`;
      const pickRef = adminDb.doc(
        `${seasonBase}/games/gw-${gwn}/picks/${pickId}`,
      );

      // Optional safety: prevent same user picking same fixture twice
      const alreadyPickedSnap = await tx.get(pickRef);
      if (alreadyPickedSnap.exists)
        throw new Error("You already picked this fixture");
      if (draftMode === "parallel") {
        const myPicksSnap = await tx.get(picksCol.where("uid", "==", userUid));
        myPickCountBeforeWrite = myPicksSnap.size;
      }

      // -------- WRITES AFTER --------
      tx.set(
        pickRef,
        {
          uid: userUid,
          fixtureId: fixtureIdToPick,
          score: sc,
          createdAt: new Date(),
        },
        { merge: false },
      );

      if (draftMode === "parallel") {
        const myPickCountAfterWrite = myPickCountBeforeWrite + 1;
        if (myPickCountAfterWrite >= fixtureIds.length) {
          readyByUid[userUid] = true;
        }

        const everyoneReady = order.every((uidInGame) => readyByUid[uidInGame] === true);
        tx.update(gameRef, {
          draftReadyByUid: readyByUid,
          ...(everyoneReady ? { state: "GOLDEN" } : {}),
        });
      } else {
        const nextTurn = currentTurn + 1;
        if (nextTurn >= totalTurns) {
          tx.update(gameRef, { currentTurn: nextTurn, state: "GOLDEN" });
        } else {
          tx.update(gameRef, { currentTurn: nextTurn });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pick failed" },
      { status: 400 },
    );
  }
}
