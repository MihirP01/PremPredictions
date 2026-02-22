import { NextResponse } from "next/server";

const LEAGUE = "PL";
const SEASON_START_MONTH_UTC = 7; // Aug

function inferSeasonKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= SEASON_START_MONTH_UTC ? year : year - 1;
  const yyStart = String(startYear % 100).padStart(2, "0");
  const yyEnd = String((startYear + 1) % 100).padStart(2, "0");
  return `${yyStart}${yyEnd}`;
}

function normalizeSeasonKey(input) {
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) return raw;
  const short = /^(\d{2})[/-](\d{2})$/.exec(raw);
  if (short) return `${short[1]}${short[2]}`;
  const long = /^(\d{4})[/-]?(\d{2,4})$/.exec(raw);
  if (long) {
    const startYY = String(Number(long[1]) % 100).padStart(2, "0");
    const endYY = String(Number(long[2]) % 100).padStart(2, "0");
    return `${startYY}${endYY}`;
  }
  return null;
}

function seasonStartYearFromKey(seasonKey) {
  return 2000 + Number(String(seasonKey).slice(0, 2));
}

// YYYY-MM-DD in UTC
function fmt(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampGW(gw) {
  return Math.min(38, Math.max(1, gw));
}

export async function GET(req) {
  const API_KEY = process.env.FOOTBALLDATA_KEY;
  if (!API_KEY) {
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const requestedSeason = searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const season = seasonStartYearFromKey(seasonKey);

  // Pull a wide window so postponed/shifted schedules still include the
  // active + next gameweeks.
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 120);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 120);

  const url =
    `https://api.football-data.org/v4/competitions/${LEAGUE}/matches` +
    `?season=${season}&dateFrom=${fmt(from)}&dateTo=${fmt(to)}`;

  const res = await fetch(url, {
    headers: { "X-Auth-Token": API_KEY },
    next: { revalidate: 300 }, // cache 5 min
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") || "11";
    return NextResponse.json(
      { error: "Rate limited", retryAfterSeconds: Number(retryAfter) || 11 },
      {
        status: 429,
        headers: { "Retry-After": retryAfter, "Cache-Control": "no-store" },
      },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("current-gameweek upstream error:", res.status, body);
    return NextResponse.json({ error: "Football API error" }, { status: 502 });
  }

  const data = await res.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];

  // Build per-matchday kickoff bounds from dates.
  const byMd = new Map(); // md -> { earliestKickoffMs, latestKickoffMs, latestStartedKickoffMs, total }
  const nowMs = now.getTime();
  for (const m of matches) {
    const md = m?.matchday;
    if (!Number.isFinite(md)) continue;

    const kickoffMs = Date.parse(String(m?.utcDate || ""));
    if (!Number.isFinite(kickoffMs)) continue;

    const entry = byMd.get(md) ?? {
      total: 0,
      earliestKickoffMs: kickoffMs,
      latestKickoffMs: kickoffMs,
      latestStartedKickoffMs: null,
    };
    entry.total += 1;
    entry.earliestKickoffMs = Math.min(entry.earliestKickoffMs, kickoffMs);
    entry.latestKickoffMs = Math.max(entry.latestKickoffMs, kickoffMs);
    if (kickoffMs <= nowMs) {
      entry.latestStartedKickoffMs =
        entry.latestStartedKickoffMs == null
          ? kickoffMs
          : Math.max(entry.latestStartedKickoffMs, kickoffMs);
    }

    byMd.set(md, entry);
  }

  const matchdays = [...byMd.keys()].sort((a, b) => a - b);

  // Date-based GW rule:
  // - Determine the next upcoming matchday by earliest kickoff > now.
  // - Current GW is the previous matchday until its rollover time:
  //   09:00 UTC on the day after that GW's last kickoff.
  // - This prevents isolated rescheduled fixtures in future GWs from
  //   incorrectly jumping the active GW.
  let nextOpen = null;
  const upcomingMds = matchdays
    .filter((md) => (byMd.get(md)?.earliestKickoffMs ?? Number.POSITIVE_INFINITY) > nowMs)
    .sort((a, b) => a - b);

  if (upcomingMds.length > 0) {
    const nextUpcomingMd = upcomingMds[0];
    const prevMd = nextUpcomingMd - 1;
    const prev = byMd.get(prevMd);
    if (!prev) {
      nextOpen = nextUpcomingMd;
    } else {
      const rolloverAt = new Date(prev.latestKickoffMs);
      rolloverAt.setUTCDate(rolloverAt.getUTCDate() + 1);
      rolloverAt.setUTCHours(9, 0, 0, 0);
      nextOpen = nowMs >= rolloverAt.getTime() ? nextUpcomingMd : prevMd;
    }
  } else if (matchdays.length > 0) {
    const latestMd = Math.max(...matchdays);
    const latest = byMd.get(latestMd);
    if (!latest) {
      nextOpen = latestMd;
    } else {
      const rolloverAt = new Date(latest.latestKickoffMs);
      rolloverAt.setUTCDate(rolloverAt.getUTCDate() + 1);
      rolloverAt.setUTCHours(9, 0, 0, 0);
      nextOpen = nowMs >= rolloverAt.getTime() ? latestMd + 1 : latestMd;
    }
  } else {
    nextOpen = 1;
  }
  nextOpen = clampGW(Number.isFinite(nextOpen) ? Number(nextOpen) : 1);

  return NextResponse.json(
    {
      currentGameweek: nextOpen,
      seasonKey,
      debug: {
        window: { dateFrom: fmt(from), dateTo: fmt(to) },
        matchdaysSeen: matchdays.length,
        selectedBy: "next-upcoming-then-rollover-0900-utc",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
