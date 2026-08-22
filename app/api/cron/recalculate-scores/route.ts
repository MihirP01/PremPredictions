export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey, seasonStartYear } from "../../season";
import { FieldValue } from "firebase-admin/firestore";
import {
  applyFixtureScoring,
  getBasePointsFromScores,
} from "../../../../lib/powerupScoring";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === secret;
}

type RecalcResult = {
  roomCode: string;
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
};

type GameDoc = {
  players?: string[];
  fixtureIds?: number[];
  gameModeStyle?: "round_robin" | "sprint" | "captain" | "league";
  leagueFairPlayEnabled?: boolean;
  leagueSubmittedByUid?: Record<string, boolean>;
  voidedFixtureIds?: number[];
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

type FixtureItem = {
  fixtureId?: number;
  status?: string | null;
  result?: string | null;
};

function isFinalStatus(status: string | null | undefined) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  return s === "FINISHED" || s === "FT" || s === "AWARDED";
}

const VOIDED_FIXTURE_STATUSES = new Set([
  "POSTPONED",
  "SUSPENDED",
  "CANCELLED",
]);

function buildBaseUrl(req: Request) {
  const host = req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const proto =
    forwardedProto || (host?.includes("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

async function fetchActualResultsForGw(
  baseUrl: string,
  gw: number,
  seasonKey: string,
) {
  const res = await fetch(
    `${baseUrl}/api/fixtures?gameweek=${gw}&seasonKey=${seasonKey}&refresh=1&t=${Date.now()}`,
    {
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`Fixtures API error: ${res.status}`);

  const data = (await res.json().catch(() => ({}))) as {
    fixtures?: FixtureItem[];
  };

  const actualByFixture = new Map<number, string>();
  const voidedFixtureIds = new Set<number>();
  const matches = Array.isArray(data.fixtures) ? data.fixtures : [];
  for (const m of matches) {
    const id = Number(m?.fixtureId);
    if (!Number.isFinite(id)) continue;
    const status = String(m?.status || "")
      .trim()
      .toUpperCase();
    if (VOIDED_FIXTURE_STATUSES.has(status)) {
      voidedFixtureIds.add(id);
      continue;
    }
    if (m?.result && isFinalStatus(status)) {
      actualByFixture.set(id, String(m.result));
    }
  }
  return { actualByFixture, voidedFixtureIds };
}

async function runCurrentGwRecalcForRoom(
  baseUrl: string,
  roomCode: string,
  gw: number,
  seasonKey: string,
): Promise<RecalcResult> {
  try {
    const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;
    const gameBase = `${seasonBase}/games/gw-${gw}`;

    const gameSnap = await adminDb.doc(gameBase).get();
    if (!gameSnap.exists) {
      return {
        roomCode,
        ok: true,
        status: 200,
        payload: {
          ok: true,
          scored: 0,
          scoredGameweeks: 0,
          targetGws: [gw],
          seasonKey,
          results: [
            {
              gw,
              status: "skipped",
              scoredUsers: 0,
              message: "Game not found",
            },
          ],
        },
      };
    }

    const game = gameSnap.data() as GameDoc;
    const players = Array.isArray(game.players) ? game.players : [];
    const fixtureIds = Array.isArray(game.fixtureIds) ? game.fixtureIds : [];

    if (players.length === 0 || fixtureIds.length === 0) {
      return {
        roomCode,
        ok: true,
        status: 200,
        payload: {
          ok: true,
          scored: 0,
          scoredGameweeks: 0,
          targetGws: [gw],
          seasonKey,
          results: [
            {
              gw,
              status: "skipped",
              scoredUsers: 0,
              message: "Missing players/fixtures",
            },
          ],
        },
      };
    }

    const fixtureResults = await fetchActualResultsForGw(
      baseUrl,
      gw,
      seasonKey,
    );
    const actualByFixture = fixtureResults.actualByFixture;
    const voidedFixtureIds = new Set(
      Array.isArray(game.voidedFixtureIds)
        ? game.voidedFixtureIds.map(Number).filter(Number.isFinite)
        : [],
    );
    fixtureResults.voidedFixtureIds.forEach((fixtureId) =>
      voidedFixtureIds.add(fixtureId),
    );
    voidedFixtureIds.forEach((fixtureId) => actualByFixture.delete(fixtureId));
    if (actualByFixture.size === 0) {
      return {
        roomCode,
        ok: true,
        status: 200,
        payload: {
          ok: true,
          scored: 0,
          scoredGameweeks: 0,
          targetGws: [gw],
          seasonKey,
          results: [
            {
              gw,
              status: "skipped",
              scoredUsers: 0,
              message: "No finished results yet",
            },
          ],
        },
      };
    }

    const picksSnap = await adminDb.collection(`${gameBase}/picks`).get();
    const picks = picksSnap.docs.map((d) => d.data() as PickDoc);
    const pickMap = new Map<string, string>();
    for (const p of picks) {
      const uid = String(p.uid || "");
      const fid = Number(p.fixtureId);
      const score = String(p.score || "").trim();
      if (!uid || !Number.isFinite(fid) || !score) continue;
      pickMap.set(`${uid}|${fid}`, score);
    }

    const goldenSnap = await adminDb.collection(`${gameBase}/golden`).get();
    const goldenByUid = new Map<
      string,
      { fixtureId: number; locked: boolean }
    >();
    for (const d of goldenSnap.docs) {
      const data = d.data() as GoldenDoc;
      goldenByUid.set(d.id, {
        fixtureId: Number(data.fixtureId),
        locked: !!data.locked,
      });
    }
    const powerupsSnap = await adminDb.collection(`${gameBase}/powerups`).get();
    const powerupByUid = new Map<
      string,
      {
        fixtureId: number;
        locked: boolean;
        powerupType: "ALL_IN" | "SAFETY_NET";
      }
    >();
    for (const d of powerupsSnap.docs) {
      const data = d.data() as PowerupDoc;
      const powerupType = String(data.powerupType || "").toUpperCase();
      if (powerupType !== "ALL_IN" && powerupType !== "SAFETY_NET") continue;
      powerupByUid.set(d.id, {
        fixtureId: Number(data.fixtureId),
        locked: !!data.locked,
        powerupType: powerupType as "ALL_IN" | "SAFETY_NET",
      });
    }

    const calculated = players.map((uid) => {
      let total = 0;
      const hasPrediction =
        game.leagueSubmittedByUid?.[uid] === true ||
        fixtureIds.some((fid) => pickMap.has(`${uid}|${fid}`));
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
        if (voidedFixtureIds.has(fid)) continue;
        const actual = actualByFixture.get(fid);
        if (!actual) continue;
        const pred = pickMap.get(`${uid}|${fid}`) || "";
        const base = getBasePointsFromScores(pred, actual);
        const golden = goldenFixtureId === fid;
        const powerupType = powerupFixtureId === fid ? activePowerupType : null;
        const pts = applyFixtureScoring({
          basePoints: base,
          isGolden: golden,
          powerupType,
        });
        total += pts;
        breakdown[String(fid)] = {
          pred: pred || null,
          actual,
          base,
          golden,
          powerupType,
          total: pts,
        };
      }

      return { uid, rawPoints: total, hasPrediction, breakdown };
    });

    const isLeague = game.gameModeStyle === "league";
    const fairPlayEnabled = isLeague && game.leagueFairPlayEnabled === true;
    const fairPlayMedian = median(
      calculated
        .filter((entry) => entry.hasPrediction)
        .map((entry) => entry.rawPoints),
    );
    const batch = adminDb.batch();
    let scoredUsers = 0;

    for (const entry of calculated) {
      const missed = isLeague && !entry.hasPrediction;
      const fairPlayApplied =
        missed && fairPlayEnabled && fairPlayMedian != null;
      const points = fairPlayApplied
        ? Math.round((fairPlayMedian / 2) * 100) / 100
        : entry.rawPoints;
      const scoreStatus = fairPlayApplied
        ? "fair_play_bye"
        : missed
          ? "missed"
          : "scored";
      batch.set(
        adminDb.doc(`${seasonBase}/scores/gw-${gw}/users/${entry.uid}`),
        {
          uid: entry.uid,
          gw,
          points,
          rawPoints: entry.rawPoints,
          breakdown: entry.breakdown,
          scoreStatus,
          fairPlayApplied,
          fairPlayMedian: fairPlayApplied ? fairPlayMedian : null,
          computedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      scoredUsers += 1;
    }

    if (game.gameModeStyle === "league") {
      batch.set(
        adminDb.doc(gameBase),
        { voidedFixtureIds: [...voidedFixtureIds].sort((a, b) => a - b) },
        { merge: true },
      );
    }

    batch.set(
      adminDb.doc(`${seasonBase}/scores/gw-${gw}`),
      {
        gw,
        roomCode,
        scoredUsers,
        fixturesWithResults: actualByFixture.size,
        leagueFairPlayEnabled: fairPlayEnabled,
        fairPlayMedian,
        computedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();

    return {
      roomCode,
      ok: true,
      status: 200,
      payload: {
        ok: true,
        scored: scoredUsers,
        scoredGameweeks: 1,
        targetGws: [gw],
        seasonKey,
        results: [{ gw, status: "scored", scoredUsers }],
      },
    };
  } catch (e: unknown) {
    return {
      roomCode,
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : "Recalc failed",
    };
  }
}

const EXPECTED_MATCHES_PER_GW = 10;

function fmtYmdUtc(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampGw(gw: number) {
  return Math.min(38, Math.max(1, gw));
}

async function getCurrentGw(seasonKey: string) {
  const apiKey = process.env.FOOTBALLDATA_KEY;
  if (!apiKey) throw new Error("Missing env var: FOOTBALLDATA_KEY");

  const season = seasonStartYear(seasonKey);
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 21);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 35);

  const url =
    `https://api.football-data.org/v4/competitions/PL/matches` +
    `?season=${season}&dateFrom=${fmtYmdUtc(from)}&dateTo=${fmtYmdUtc(to)}`;

  const res = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Football API error: ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as {
    matches?: Array<{ matchday?: number; status?: string }>;
  };
  const matches = Array.isArray(data.matches) ? data.matches : [];

  const byMd = new Map<number, { total: number; finished: number }>();
  for (const m of matches) {
    const md = Number(m?.matchday);
    if (!Number.isFinite(md)) continue;
    const row = byMd.get(md) ?? { total: 0, finished: 0 };
    row.total += 1;
    if (m?.status === "FINISHED") row.finished += 1;
    byMd.set(md, row);
  }

  const matchdays = [...byMd.keys()].sort((a, b) => a - b);
  let nextOpen: number | null = null;
  for (const md of matchdays) {
    const row = byMd.get(md);
    if (!row) continue;
    if (row.finished < row.total) {
      nextOpen = md;
      break;
    }
    if (
      row.total >= EXPECTED_MATCHES_PER_GW &&
      row.finished >= EXPECTED_MATCHES_PER_GW
    ) {
      continue;
    }
    nextOpen = md;
    break;
  }

  if (!Number.isFinite(nextOpen as number)) {
    const maxMd = matchdays.length ? Math.max(...matchdays) : 1;
    nextOpen = maxMd + 1;
  }

  const gw = clampGw(Number(nextOpen));
  if (!Number.isFinite(gw) || gw < 1 || gw > 38) {
    throw new Error("Invalid gameweek");
  }
  return gw;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let stage = "init";
  try {
    const baseUrl = buildBaseUrl(req);
    stage = "parse-url";
    const url = new URL(req.url);
    const seasonKey = resolveSeasonKey(url.searchParams.get("seasonKey"));
    stage = "current-gw";
    const gw = await getCurrentGw(seasonKey);

    stage = "load-rooms";
    const roomsSnap = await adminDb.collection("rooms").get();
    const roomCodes = roomsSnap.docs.map((d) => d.id).filter(Boolean);

    stage = "recalculate";
    const results: RecalcResult[] = [];
    for (const roomCode of roomCodes) {
      results.push(
        await runCurrentGwRecalcForRoom(baseUrl, roomCode, gw, seasonKey),
      );
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      ok: true,
      seasonKey,
      gw,
      rooms: roomCodes.length,
      success: okCount,
      failed: roomCodes.length - okCount,
      results,
      ranAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Cron recalc failed",
        stage,
      },
      { status: 500 },
    );
  }
}
