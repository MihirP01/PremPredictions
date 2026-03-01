export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { resolveSeasonKey } from "../../season";
import {
  applyFixtureScoring,
  getBasePointsFromScores,
} from "../../../../lib/powerupScoring";

type GameDoc = {
  players?: string[];
  fixtureIds?: number[];
};

type FixtureItem = {
  fixtureId?: number;
  status?: string | null;
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

type PowerupDoc = {
  fixtureId?: number;
  locked?: boolean;
  powerupType?: string;
};

type GwRunResult = {
  gw: number;
  status: "scored" | "skipped" | "error";
  scoredUsers: number;
  message?: string;
};

function isFinalStatus(status: string | null | undefined) {
  const s = String(status || "").trim().toUpperCase();
  return s === "FINISHED" || s === "FT" || s === "AWARDED";
}

function buildBaseUrl(req: Request) {
  const host = req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const proto =
    forwardedProto ||
    (host?.includes("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

async function fetchActualResultsForGw(
  baseUrl: string,
  gw: number,
  seasonKey: string,
) {
  const fxRes = await fetch(
    `${baseUrl}/api/fixtures?gameweek=${gw}&seasonKey=${seasonKey}&refresh=1&t=${Date.now()}`,
    {
      cache: "no-store",
    },
  );
  if (!fxRes.ok) {
    throw new Error(`Failed to load fixtures for GW${gw}`);
  }

  const fxData = (await fxRes.json()) as { fixtures?: FixtureItem[] };
  const fixtures: FixtureItem[] = Array.isArray(fxData.fixtures)
    ? fxData.fixtures
    : [];

  const actualByFixture = new Map<number, string>();
  for (const f of fixtures) {
    const id = Number(f.fixtureId);
    if (!Number.isFinite(id)) continue;
    if (f.result && isFinalStatus(f.status)) actualByFixture.set(id, String(f.result));
  }

  return actualByFixture;
}

async function scoreSingleGw(
  baseUrl: string,
  roomCode: string,
  gw: number,
  seasonKey: string,
): Promise<GwRunResult> {
  const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;
  const gameBase = `${seasonBase}/games/gw-${gw}`;
  const gameSnap = await adminDb.doc(gameBase).get();
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

  const actualByFixture = await fetchActualResultsForGw(baseUrl, gw, seasonKey);

  if (actualByFixture.size === 0) {
    return {
      gw,
      status: "skipped",
      scoredUsers: 0,
      message: "No finished results yet",
    };
  }

  const picksSnap = await adminDb
    .collection(`${gameBase}/picks`)
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
    .collection(`${gameBase}/golden`)
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

  const powerupsSnap = await adminDb.collection(`${gameBase}/powerups`).get();
  const powerupByUid = new Map<
    string,
    { fixtureId: number; locked: boolean; powerupType: "ALL_IN" | "SAFETY_NET" }
  >();
  for (const d of powerupsSnap.docs) {
    const data = d.data() as PowerupDoc;
    const powerupType = String(data.powerupType || "").toUpperCase();
    if (powerupType !== "ALL_IN" && powerupType !== "SAFETY_NET")
      continue;
    powerupByUid.set(d.id, {
      fixtureId: Number(data.fixtureId),
      locked: !!data.locked,
      powerupType: powerupType as "ALL_IN" | "SAFETY_NET",
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
          powerupType: "ALL_IN" | "SAFETY_NET" | null;
          total: number;
        }
      > = {};

    const g = goldenByUid.get(uid);
    const goldenFixtureId = g?.locked ? g.fixtureId : null;
    const pwr = powerupByUid.get(uid);
    const powerupFixtureId = pwr?.locked ? pwr.fixtureId : null;
    const activePowerupType = pwr?.locked ? pwr.powerupType : null;

    for (const fid of fixtureIds) {
      const actual = actualByFixture.get(fid);
      if (!actual) continue;

      const pred = pickMap.get(`${uid}|${fid}`) || "";
      const base = getBasePointsFromScores(pred, actual);
      const isGolden = goldenFixtureId === fid;
      const powerupType = powerupFixtureId === fid ? activePowerupType : null;
      const pts = applyFixtureScoring({
        basePoints: base,
        isGolden,
        powerupType,
      });

      total += pts;
      breakdown[String(fid)] = {
        pred: pred || null,
        actual,
        base,
        golden: isGolden,
        powerupType,
        total: pts,
      };
    }

    const scoreRef = adminDb.doc(
      `${seasonBase}/scores/gw-${gw}/users/${uid}`,
    );
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

  const weekSummaryRef = adminDb.doc(`${seasonBase}/scores/gw-${gw}`);
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
    const { roomCode, gw, seasonKey, currentOnly } = (await req.json()) as {
      roomCode?: string;
      gw?: number;
      seasonKey?: string;
      currentOnly?: boolean;
    };

    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);
    const sk = resolveSeasonKey(seasonKey);
    if (!rc)
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    if (!Number.isFinite(gwn) || gwn < 1 || gwn > 38)
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });

    const baseUrl = buildBaseUrl(req);

    const targetGws = currentOnly ? [gwn] : [gwn, gwn - 1, gwn - 2].filter((n) => n >= 1);
    const results: GwRunResult[] = [];

    for (const targetGw of targetGws) {
      try {
        const result = await scoreSingleGw(baseUrl, rc, targetGw, sk);
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
      seasonKey: sk,
      results,
    });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "score failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
