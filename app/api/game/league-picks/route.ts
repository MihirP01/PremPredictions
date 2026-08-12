export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey } from "../../season";
import { getBaseUrl, loadGwFixturesWithLockWindow } from "../lock-window";

type LeaguePickInput = {
  fixtureId?: number;
  score?: string | null;
};

type LeaguePicksBody = {
  roomCode?: string;
  gw?: number;
  uid?: string;
  seasonKey?: string;
  picks?: LeaguePickInput[];
};

type GameDoc = {
  state?: string;
  players?: string[];
  fixtureIds?: number[];
  gameModeStyle?: string;
  lockAt?: unknown;
  leagueSubmittedByUid?: Record<string, boolean>;
  voidedFixtureIds?: number[];
};

function timestampMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.toDate === "function")
      return candidate.toDate().getTime();
    const seconds = Number(candidate.seconds ?? candidate._seconds);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

function normalizeScore(value: unknown) {
  const score = String(value ?? "").trim();
  if (!score) return null;
  if (!/^\d{1,2}-\d{1,2}$/.test(score)) {
    throw new Error("Scores must use the format 2-1");
  }
  return score;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LeaguePicksBody;
    const roomCode = String(body.roomCode || "")
      .trim()
      .toUpperCase();
    const gw = Number(body.gw);
    const uid = String(body.uid || "").trim();
    const seasonKey = resolveSeasonKey(body.seasonKey);
    const submittedPicks = Array.isArray(body.picks) ? body.picks : [];

    if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    if (!Number.isFinite(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    }
    if (!uid) {
      return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    }

    const gameBase = `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}`;
    const gameRef = adminDb.doc(gameBase);

    const currentFixtures = await loadGwFixturesWithLockWindow(
      getBaseUrl(req),
      gw,
      seasonKey,
    );
    const currentlyEligible = new Set(currentFixtures.fixtureIds);

    const savedCount = await adminDb.runTransaction(async (tx) => {
      const gameSnap = await tx.get(gameRef);
      if (!gameSnap.exists) throw new Error("League predictions are not open");

      const game = gameSnap.data() as GameDoc;
      if (game.state !== "DRAFT" || game.gameModeStyle !== "league") {
        throw new Error("League predictions are not open");
      }

      const players = Array.isArray(game.players) ? game.players : [];
      if (!players.includes(uid))
        throw new Error("You are not in this League roster");
      if (game.leagueSubmittedByUid?.[uid] === true) {
        throw new Error("Your League predictions are already locked");
      }

      const lockAt = timestampMs(game.lockAt);
      if (lockAt != null && Date.now() >= lockAt) {
        throw new Error("The gameweek deadline has passed");
      }

      const fixtureIds = Array.isArray(game.fixtureIds)
        ? game.fixtureIds.map(Number).filter(Number.isFinite)
        : [];
      const storedVoids = new Set(
        Array.isArray(game.voidedFixtureIds)
          ? game.voidedFixtureIds.map(Number).filter(Number.isFinite)
          : [],
      );
      for (const fixtureId of fixtureIds) {
        if (!currentlyEligible.has(fixtureId)) storedVoids.add(fixtureId);
      }
      const requiredFixtureIds = fixtureIds.filter(
        (fixtureId) => !storedVoids.has(fixtureId),
      );
      if (!requiredFixtureIds.length) {
        throw new Error("There are no eligible fixtures left to predict");
      }

      const allowedFixtures = new Set(requiredFixtureIds);
      const byFixture = new Map<number, string>();
      for (const pick of submittedPicks) {
        const fixtureId = Number(pick.fixtureId);
        if (!Number.isFinite(fixtureId) || !allowedFixtures.has(fixtureId)) {
          throw new Error("A submitted fixture is not part of this gameweek");
        }
        const score = normalizeScore(pick.score);
        if (!score) throw new Error("Every eligible fixture needs a score");
        if (byFixture.has(fixtureId)) {
          throw new Error("A fixture was submitted more than once");
        }
        byFixture.set(fixtureId, score);
      }

      if (
        byFixture.size !== requiredFixtureIds.length ||
        requiredFixtureIds.some((fixtureId) => !byFixture.has(fixtureId))
      ) {
        throw new Error("Predict every eligible fixture before submitting");
      }

      for (const fixtureId of requiredFixtureIds) {
        const pickRef = adminDb.doc(`${gameBase}/picks/${uid}_${fixtureId}`);
        const score = byFixture.get(fixtureId) as string;
        tx.set(
          pickRef,
          {
            uid,
            fixtureId,
            score,
            updatedAt: new Date(),
          },
          { merge: false },
        );
      }

      tx.update(gameRef, {
        leagueSubmittedByUid: {
          ...(game.leagueSubmittedByUid ?? {}),
          [uid]: true,
        },
        voidedFixtureIds: [...storedVoids].sort((a, b) => a - b),
      });

      return requiredFixtureIds.length;
    });

    return NextResponse.json({ ok: true, savedCount });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save picks",
      },
      { status: 400 },
    );
  }
}
