export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode } from "@/lib/roomCode";
import { resolveSeasonKey } from "../../season";
import { applyFixtureScoring, getBasePointsFromScores } from "@/lib/powerupScoring";
import { isScoredFixtureStatus } from "@/lib/fixtureLive";
import {
  getPostgresGameData,
  getPostgresGameState,
  getPostgresRoomSummary,
} from "@/lib/server/postgres-read-model";
import {
  mirrorGameStateToPostgres,
  mirrorWeeklyScoresToPostgres,
} from "@/lib/server/postgres-room-repository";
import {
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";

type FixtureItem = { fixtureId?: number; status?: string | null; result?: string | null };
export type GwRunResult = {
  gw: number;
  status: "scored" | "skipped" | "error";
  scoredUsers: number;
  message?: string;
};

const VOIDED = new Set(["POSTPONED", "SUSPENDED", "CANCELLED"]);

function baseUrl(req: Request) {
  const host = req.headers.get("host");
  const protocol = req.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function actualResults(url: string, gw: number, seasonKey: string) {
  const response = await fetch(
    `${url}/api/fixtures?gameweek=${gw}&seasonKey=${seasonKey}&refresh=1&t=${Date.now()}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Failed to load fixtures for GW${gw}`);
  const payload = (await response.json()) as { fixtures?: FixtureItem[] };
  const actual = new Map<number, string>();
  const voided = new Set<number>();
  for (const fixture of payload.fixtures ?? []) {
    const id = Number(fixture.fixtureId);
    if (!Number.isFinite(id)) continue;
    const status = String(fixture.status || "").toUpperCase();
    if (VOIDED.has(status)) voided.add(id);
    else if (fixture.result && isScoredFixtureStatus(fixture.status)) {
      actual.set(id, String(fixture.result));
    }
  }
  return { actual, voided };
}

export async function scoreRoomGameweek(
  url: string,
  roomCode: string,
  gw: number,
  seasonKey: string,
): Promise<GwRunResult> {
  const game = await getPostgresGameState(roomCode, seasonKey, gw);
  if (!game) return { gw, status: "skipped", scoredUsers: 0, message: "Game not found" };
  const isLeague = game.gameModeStyle === "league";
  const players = Array.isArray(game.players)
    ? game.players.map(String)
    : [];
  const fixtureIds = Array.isArray(game.fixtureIds)
    ? game.fixtureIds.map(Number).filter(Number.isFinite)
    : [];
  if (!players.length || !fixtureIds.length) {
    return { gw, status: "skipped", scoredUsers: 0, message: "Missing players/fixtures" };
  }

  const results = await actualResults(url, gw, seasonKey);
  const voided = new Set(
    Array.isArray(game.voidedFixtureIds)
      ? game.voidedFixtureIds.map(Number).filter(Number.isFinite)
      : [],
  );
  results.voided.forEach((id) => voided.add(id));
  voided.forEach((id) => results.actual.delete(id));
  if (!results.actual.size) {
    return { gw, status: "skipped", scoredUsers: 0, message: "No finished results yet" };
  }

  const data = await getPostgresGameData(roomCode, seasonKey, gw, true);
  const pickMap = new Map(data.picks.map((pick) => [`${pick.uid}|${pick.fixtureId}`, pick.score]));
  const goldenMap = new Map(data.goldens.map((pick) => [pick.uid, pick]));
  const powerupMap = new Map(data.powerups.map((pick) => [pick.uid, pick]));
  const submitted =
    game.leagueSubmittedByUid && typeof game.leagueSubmittedByUid === "object"
      ? (game.leagueSubmittedByUid as Record<string, boolean>)
      : {};

  const calculated = players.map((uid) => {
    let rawPoints = 0;
    const breakdown: Record<string, Record<string, unknown>> = {};
    for (const fixtureId of fixtureIds) {
      if (voided.has(fixtureId)) continue;
      const actual = results.actual.get(fixtureId);
      if (!actual) continue;
      const pred = pickMap.get(`${uid}|${fixtureId}`) || "";
      const base = getBasePointsFromScores(pred, actual);
      const golden = goldenMap.get(uid)?.locked === true && goldenMap.get(uid)?.fixtureId === fixtureId;
      const powerup = powerupMap.get(uid);
      const powerupType = powerup?.locked && powerup.fixtureId === fixtureId ? powerup.powerupType : null;
      const total = applyFixtureScoring({ basePoints: base, isGolden: golden, powerupType });
      rawPoints += total;
      breakdown[String(fixtureId)] = { pred: pred || null, actual, base, golden, powerupType, total };
    }
    const hasPrediction = submitted[uid] === true || fixtureIds.some((id) => pickMap.has(`${uid}|${id}`));
    return { uid, rawPoints, hasPrediction, breakdown };
  });

  const fairPlayEnabled =
    isLeague && game.leagueFairPlayEnabled === true;
  const fairPlayMedian = median(calculated.filter((entry) => entry.hasPrediction).map((entry) => entry.rawPoints));
  const scores: Parameters<typeof mirrorWeeklyScoresToPostgres>[0]["scores"] = calculated.map((entry) => {
    const missed = isLeague && !entry.hasPrediction;
    const fairPlayApplied = missed && fairPlayEnabled && fairPlayMedian != null;
    return {
      uid: entry.uid,
      points: fairPlayApplied ? Math.round((fairPlayMedian / 2) * 100) / 100 : entry.rawPoints,
      rawPoints: entry.rawPoints,
      breakdown: entry.breakdown,
      scoreStatus: fairPlayApplied ? "fair_play_bye" : missed ? "missed" : "scored",
      fairPlayApplied,
      fairPlayMedian: fairPlayApplied ? fairPlayMedian : null,
    };
  });
  await mirrorWeeklyScoresToPostgres({ roomCode, seasonKey, gameweek: gw, scores });
  if (isLeague) {
    await mirrorGameStateToPostgres({
      roomCode,
      seasonKey,
      gameweek: gw,
      data: { ...game, voidedFixtureIds: [...voided].sort((a, b) => a - b) },
    });
  }
  return { gw, status: "scored", scoredUsers: scores.length };
}

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as {
      roomCode?: string;
      gw?: number;
      seasonKey?: string;
    };
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const seasonKey = resolveSeasonKey(body.seasonKey);
    if (!requested || !Number.isInteger(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Bad scoring request" }, { status: 400 });
    }
    const roomSummary = await getPostgresRoomSummary(requested);
    const roomCode = roomSummary.code;
    if (roomSummary.leaderUid !== user.uid) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }
    const targetGws = [gw];
    const results: GwRunResult[] = [];
    for (const target of targetGws) {
      try {
        results.push(await scoreRoomGameweek(baseUrl(req), roomCode, target, seasonKey));
      } catch (error) {
        results.push({ gw: target, status: "error", scoredUsers: 0, message: error instanceof Error ? error.message : "score failed" });
      }
    }
    return NextResponse.json({
      ok: true,
      scored: results.filter((r) => r.status === "scored").reduce((sum, r) => sum + r.scoredUsers, 0),
      scoredGameweeks: results.filter((r) => r.status === "scored").length,
      targetGws,
      seasonKey,
      results,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "score failed" }, { status: 500 });
  }
}
