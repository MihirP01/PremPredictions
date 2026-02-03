export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

type GameDoc = {
  players?: string[];
  fixtureIds?: number[];
};

type FixtureItem = {
  fixtureId?: number;
  result?: string | null;
};

type PickDoc = {
  uid?: string;
  fixtureId?: number;
  score?: string;
};

type GoldenDoc = {
  fixtureId?: number;
  locked?: boolean;
};

type GwRunResult = {
  gw: number;
  status: "scored" | "skipped" | "error";
  scoredUsers: number;
  message?: string;
};

function outcome(h: number, a: number) {
  if (h > a) return "H";
  if (h < a) return "A";
  return "D";
}

function parseScore(s: string | null | undefined) {
  if (!s) return null;
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { h: Number(m[1]), a: Number(m[2]) };
}

function basePoints(pred: string, actual: string) {
  const p = parseScore(pred);
  const r = parseScore(actual);
  if (!p || !r) return 0;

  if (p.h === r.h && p.a === r.a) return 2; // exact
  if (outcome(p.h, p.a) === outcome(r.h, r.a)) return 1; // correct result
  return 0;
}

async function scoreSingleGw(
  baseUrl: string,
  roomCode: string,
  gw: number,
): Promise<GwRunResult> {
  const gameRef = adminDb.doc(`rooms/${roomCode}/games/gw-${gw}`);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) {
    return { gw, status: "skipped", scoredUsers: 0, message: "Game not found" };
  }

  const game = gameSnap.data() as GameDoc;
  const players: string[] = Array.isArray(game.players) ? game.players : [];
  const fixtureIds: number[] = Array.isArray(game.fixtureIds)
    ? game.fixtureIds
    : [];

  if (players.length === 0 || fixtureIds.length === 0) {
    return {
      gw,
      status: "skipped",
      scoredUsers: 0,
      message: "Missing players/fixtures",
    };
  }

  const fxRes = await fetch(`${baseUrl}/api/fixtures?gameweek=${gw}`, {
    cache: "no-store",
  });
  if (!fxRes.ok) {
    throw new Error(`Failed to load fixtures for GW${gw}`);
  }

  const fxData = (await fxRes.json()) as { fixtures?: FixtureItem[] };
  const fixtures: FixtureItem[] = Array.isArray(fxData.fixtures)
    ? fxData.fixtures
    : [];

  // Build actual results map fixtureId -> "x-y" (only if finished)
  const actualByFixture = new Map<number, string>();
  for (const f of fixtures) {
    const id = Number(f.fixtureId);
    if (!Number.isFinite(id)) continue;
    if (f.result) actualByFixture.set(id, String(f.result));
  }

  if (actualByFixture.size === 0) {
    return {
      gw,
      status: "skipped",
      scoredUsers: 0,
      message: "No finished results yet",
    };
  }

  const picksSnap = await adminDb
    .collection(`rooms/${roomCode}/games/gw-${gw}/picks`)
    .get();
  const picks = picksSnap.docs.map((d) => d.data() as PickDoc);

  const pickMap = new Map<string, string>();
  for (const p of picks) {
    const uid = String(p.uid || "");
    const fid = Number(p.fixtureId);
    const sc = String(p.score || "").trim();
    if (!uid || !Number.isFinite(fid) || !sc) continue;
    pickMap.set(`${uid}|${fid}`, sc);
  }

  const goldenSnap = await adminDb
    .collection(`rooms/${roomCode}/games/gw-${gw}/golden`)
    .get();
  const goldenByUid = new Map<string, { fixtureId: number; locked: boolean }>();
  for (const d of goldenSnap.docs) {
    const data = d.data() as GoldenDoc;
    const uid = d.id;
    goldenByUid.set(uid, {
      fixtureId: Number(data.fixtureId),
      locked: !!data.locked,
    });
  }

  const batch = adminDb.batch();
  let scoredUsers = 0;

  for (const uid of players) {
    let total = 0;
    const breakdown: Record<
      string,
      {
        pred: string | null;
        actual: string;
        base: number;
        golden: boolean;
        total: number;
      }
    > = {};

    const g = goldenByUid.get(uid);
    const goldenFixtureId = g?.locked ? g.fixtureId : null;

    for (const fid of fixtureIds) {
      const actual = actualByFixture.get(fid);
      if (!actual) continue;

      const pred = pickMap.get(`${uid}|${fid}`) || "";
      const base = pred ? basePoints(pred, actual) : 0;
      const isGolden = goldenFixtureId === fid;
      const pts = base * (isGolden ? 2 : 1);

      total += pts;
      breakdown[String(fid)] = {
        pred: pred || null,
        actual,
        base,
        golden: isGolden,
        total: pts,
      };
    }

    const scoreRef = adminDb.doc(`rooms/${roomCode}/scores/gw-${gw}/users/${uid}`);
    batch.set(
      scoreRef,
      {
        uid,
        gw,
        points: total,
        breakdown,
        computedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    scoredUsers++;
  }

  const weekSummaryRef = adminDb.doc(`rooms/${roomCode}/scores/gw-${gw}`);
  batch.set(
    weekSummaryRef,
    {
      gw,
      roomCode,
      scoredUsers,
      fixturesWithResults: actualByFixture.size,
      computedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
  return { gw, status: "scored", scoredUsers };
}

// POST { roomCode, gw }
export async function POST(req: Request) {
  try {
    const { roomCode, gw } = (await req.json()) as {
      roomCode?: string;
      gw?: number;
    };

    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    if (!rc)
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    if (!Number.isFinite(gwn) || gwn < 1 || gwn > 38)
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });

    const host = req.headers.get("host");
    const proto = host?.includes("localhost") ? "http" : "https";
    const baseUrl = host ? `${proto}://${host}` : "http://localhost:3000";

    const targetGws = [gwn, gwn - 1, gwn - 2].filter((n) => n >= 1);
    const results: GwRunResult[] = [];

    for (const targetGw of targetGws) {
      try {
        const result = await scoreSingleGw(baseUrl, rc, targetGw);
        results.push(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "score failed";
        results.push({
          gw: targetGw,
          status: "error",
          scoredUsers: 0,
          message: msg,
        });
      }
    }

    const scored = results
      .filter((r) => r.status === "scored")
      .reduce((sum, r) => sum + r.scoredUsers, 0);
    const scoredGameweeks = results.filter((r) => r.status === "scored").length;

    return NextResponse.json({
      ok: true,
      scored,
      scoredGameweeks,
      targetGws,
      results,
    });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "score failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
