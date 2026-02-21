export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey, seasonStartYear } from "../../season";

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

async function runCurrentGwRecalcForRoom(
  origin: string,
  roomCode: string,
  gw: number,
  seasonKey: string,
): Promise<RecalcResult> {
  try {
    const res = await fetch(`${origin}/api/game/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ roomCode, gw, seasonKey, currentOnly: true }),
    });
    const payload = await res.json().catch(() => ({}));
    return {
      roomCode,
      ok: res.ok,
      status: res.status,
      payload,
      error: res.ok ? undefined : String((payload as { error?: string })?.error || "Failed"),
    };
  } catch (e: unknown) {
    return {
      roomCode,
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : "Request failed",
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
    if (row.total >= EXPECTED_MATCHES_PER_GW && row.finished >= EXPECTED_MATCHES_PER_GW) {
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
    stage = "parse-url";
    const url = new URL(req.url);
    const origin = url.origin;
    const seasonKey = resolveSeasonKey(url.searchParams.get("seasonKey"));
    stage = "current-gw";
    const gw = await getCurrentGw(seasonKey);

    stage = "load-rooms";
    const roomsSnap = await adminDb.collection("rooms").get();
    const roomCodes = roomsSnap.docs.map((d) => d.id).filter(Boolean);

    stage = "recalculate";
    const results: RecalcResult[] = [];
    for (const roomCode of roomCodes) {
      // Run one-by-one to avoid burst limits on upstream fixtures API.
      results.push(await runCurrentGwRecalcForRoom(origin, roomCode, gw, seasonKey));
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
