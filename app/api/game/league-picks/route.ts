export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey } from "../../season";

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

      const lockAt = timestampMs(game.lockAt);
      if (lockAt != null && Date.now() >= lockAt) {
        throw new Error("The gameweek deadline has passed");
      }

      const fixtureIds = Array.isArray(game.fixtureIds) ? game.fixtureIds : [];
      const allowedFixtures = new Set(fixtureIds.map(Number));
      const byFixture = new Map<number, string | null>();
      for (const pick of submittedPicks) {
        const fixtureId = Number(pick.fixtureId);
        if (!Number.isFinite(fixtureId) || !allowedFixtures.has(fixtureId)) {
          throw new Error("A submitted fixture is not part of this gameweek");
        }
        byFixture.set(fixtureId, normalizeScore(pick.score));
      }

      let count = 0;
      for (const fixtureId of fixtureIds) {
        if (!byFixture.has(fixtureId)) continue;
        const pickRef = adminDb.doc(`${gameBase}/picks/${uid}_${fixtureId}`);
        const score = byFixture.get(fixtureId);
        if (!score) {
          tx.delete(pickRef);
          continue;
        }
        tx.set(
          pickRef,
          {
            uid,
            fixtureId,
            score,
            updatedAt: new Date(),
          },
          { merge: true },
        );
        count += 1;
      }

      return count;
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
