import { NextResponse } from "next/server";
import { adminDb } from "../../../firebase-admin";

const LEAGUE = "PL";
const FOTMOB_LEAGUE_ID = 47;
const SEASON_START_MONTH_UTC = 7; // Aug
const LEAGUE_TIME_ZONE = "Europe/London";

function inferSeasonKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const startYear =
    now.getUTCMonth() >= SEASON_START_MONTH_UTC ? year : year - 1;
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

function fotmobSeasonFromStartYear(startYear) {
  return `${startYear}/${startYear + 1}`;
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

const MATCHDAY_CLUSTER_BREAK_MS = 5 * 24 * 60 * 60 * 1000;

function zonedParts(ms, timeZone) {
  const date = typeof ms === "number" ? new Date(ms) : ms;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const out = {
    year: 1970,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };

  for (const part of parts) {
    if (part.type === "year") out.year = Number(part.value);
    else if (part.type === "month") out.month = Number(part.value);
    else if (part.type === "day") out.day = Number(part.value);
    else if (part.type === "hour") out.hour = Number(part.value);
    else if (part.type === "minute") out.minute = Number(part.value);
    else if (part.type === "second") out.second = Number(part.value);
  }

  return out;
}

function zonedDateTimeToUtc(parts, timeZone) {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    0,
  );
  const actual = zonedParts(guess, timeZone);
  const actualAsUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
    0,
  );
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    0,
  );
  return guess + (desiredAsUtc - actualAsUtc);
}

function nextLocalMidnightMs(baseMs, timeZone) {
  const local = zonedParts(baseMs, timeZone);
  const nextDayProbe = Date.UTC(
    local.year,
    local.month - 1,
    local.day + 1,
    12,
    0,
    0,
    0,
  );
  const nextLocal = zonedParts(nextDayProbe, timeZone);
  return zonedDateTimeToUtc(
    {
      year: nextLocal.year,
      month: nextLocal.month,
      day: nextLocal.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

function selectCurrentGameweek(byMd, nowMs) {
  const matchdays = [...byMd.keys()].sort((a, b) => a - b);

  let nextOpen = null;
  const upcomingMds = matchdays
    .filter(
      (md) =>
        (byMd.get(md)?.earliestKickoffMs ?? Number.POSITIVE_INFINITY) > nowMs,
    )
    .sort((a, b) => a - b);

  if (upcomingMds.length > 0) {
    const nextUpcomingMd = upcomingMds[0];
    const prevMd = nextUpcomingMd - 1;
    const prev = byMd.get(prevMd);
    if (!prev) {
      nextOpen = nextUpcomingMd;
    } else {
      const rolloverAtMs = nextLocalMidnightMs(
        prev.latestKickoffMs,
        LEAGUE_TIME_ZONE,
      );
      nextOpen = nowMs >= rolloverAtMs ? nextUpcomingMd : prevMd;
    }
  } else if (matchdays.length > 0) {
    const latestMd = Math.max(...matchdays);
    const latest = byMd.get(latestMd);
    if (!latest) {
      nextOpen = latestMd;
    } else {
      const rolloverAtMs = nextLocalMidnightMs(
        latest.latestKickoffMs,
        LEAGUE_TIME_ZONE,
      );
      nextOpen = nowMs >= rolloverAtMs ? latestMd + 1 : latestMd;
    }
  } else {
    nextOpen = 1;
  }

  return {
    currentGameweek: clampGW(Number.isFinite(nextOpen) ? Number(nextOpen) : 1),
    matchdaysSeen: matchdays.length,
  };
}

function buildByMatchday(matches, nowMs) {
  const staged = new Map();

  for (const match of Array.isArray(matches) ? matches : []) {
    const md = Number(match?.matchday);
    if (!Number.isFinite(md)) continue;

    const kickoffMs = Date.parse(String(match?.utcDate || ""));
    if (!Number.isFinite(kickoffMs)) continue;

    const entry = staged.get(md) ?? [];
    entry.push(kickoffMs);
    staged.set(md, entry);
  }

  const byMd = new Map();

  for (const [md, kickoffList] of staged.entries()) {
    const orderedKickoffs = kickoffList
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!orderedKickoffs.length) continue;

    const clusters = [];
    let currentCluster = [orderedKickoffs[0]];

    for (let idx = 1; idx < orderedKickoffs.length; idx += 1) {
      const kickoffMs = orderedKickoffs[idx];
      const previousKickoffMs = orderedKickoffs[idx - 1];
      if (kickoffMs - previousKickoffMs > MATCHDAY_CLUSTER_BREAK_MS) {
        clusters.push(currentCluster);
        currentCluster = [kickoffMs];
        continue;
      }
      currentCluster.push(kickoffMs);
    }
    clusters.push(currentCluster);

    const primaryCluster = clusters.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a[0] - b[0];
    })[0];

    const earliestKickoffMs = primaryCluster[0];
    const latestKickoffMs = primaryCluster[primaryCluster.length - 1];
    const startedKickoffs = primaryCluster.filter((kickoffMs) => kickoffMs <= nowMs);

    byMd.set(md, {
      total: kickoffList.length,
      earliestKickoffMs,
      latestKickoffMs,
      latestStartedKickoffMs: startedKickoffs.length
        ? startedKickoffs[startedKickoffs.length - 1]
        : null,
    });
  }

  return byMd;
}

async function buildSnapshotCurrentGameweek(seasonKey, now) {
  try {
    const snap = await adminDb.doc(`_fixtureSnapshots/PL_${seasonKey}`).get();
    if (!snap.exists) return null;

    const raw = snap.data() || {};
    const snapshotMatches = Array.isArray(raw.matches)
      ? raw.matches
      : Object.values(raw);
    const matches = snapshotMatches.filter(
      (value) =>
        value &&
        typeof value === "object" &&
        Number.isFinite(Number(value.matchday)) &&
        value.utcDate,
    );

    if (!matches.length) return null;

    const byMd = buildByMatchday(matches, now.getTime());
    const selected = selectCurrentGameweek(byMd, now.getTime());

    return NextResponse.json(
      {
        currentGameweek: selected.currentGameweek,
        seasonKey,
        debug: {
          source: "fixture-snapshot",
          snapshotDoc: `PL_${seasonKey}`,
          matchdaysSeen: selected.matchdaysSeen,
          selectedBy: "next-upcoming-then-rollover-midnight-europe-london-snapshot",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return null;
  }
}

async function buildFotmobFallback(seasonKey, now) {
  const season = seasonStartYearFromKey(seasonKey);
  const fotmobSeason = fotmobSeasonFromStartYear(season);
  const url = `https://www.fotmob.com/api/leagues?id=${FOTMOB_LEAGUE_ID}&tab=fixtures&season=${encodeURIComponent(fotmobSeason)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 30 },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  const matches = Array.isArray(data?.fixtures?.allMatches)
    ? data.fixtures.allMatches
    : [];
  const byMd = new Map();
  const nowMs = now.getTime();

  for (const m of matches) {
    const md = Number(m?.roundName ?? m?.round);
    if (!Number.isFinite(md)) continue;

    const kickoffMs = Date.parse(String(m?.status?.utcTime || ""));
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

  const selected = selectCurrentGameweek(byMd, nowMs);
  return NextResponse.json(
    {
      currentGameweek: selected.currentGameweek,
      seasonKey,
      debug: {
        window: { source: "fotmob-fallback" },
        matchdaysSeen: selected.matchdaysSeen,
        selectedBy: "next-upcoming-then-rollover-midnight-europe-london-fotmob",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const requestedSeason = searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const season = seasonStartYearFromKey(seasonKey);

  const now = new Date();
  const snapshotCurrent = await buildSnapshotCurrentGameweek(seasonKey, now);
  if (snapshotCurrent) return snapshotCurrent;

  const API_KEY = process.env.FOOTBALLDATA_KEY;
  if (!API_KEY) {
    const fallback = await buildFotmobFallback(seasonKey, now);
    if (fallback) return fallback;
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 },
    );
  }

  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 120);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 120);

  const url =
    `https://api.football-data.org/v4/competitions/${LEAGUE}/matches` +
    `?season=${season}&dateFrom=${fmt(from)}&dateTo=${fmt(to)}`;

  const res = await fetch(url, {
    headers: { "X-Auth-Token": API_KEY },
    next: { revalidate: 300 },
  });

  if (res.status === 429) {
    const fallback = await buildFotmobFallback(seasonKey, now);
    if (fallback) return fallback;
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
    const fallback = await buildFotmobFallback(seasonKey, now);
    if (fallback) return fallback;
    const body = await res.text().catch(() => "");
    console.error("current-gameweek upstream error:", res.status, body);
    return NextResponse.json({ error: "Football API error" }, { status: 502 });
  }

  const data = await res.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];

  const selected = selectCurrentGameweek(buildByMatchday(matches, now.getTime()), now.getTime());

  return NextResponse.json(
    {
      currentGameweek: selected.currentGameweek,
      seasonKey,
      debug: {
        window: { dateFrom: fmt(from), dateTo: fmt(to) },
        matchdaysSeen: selected.matchdaysSeen,
        selectedBy: "next-upcoming-then-rollover-midnight-europe-london",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
