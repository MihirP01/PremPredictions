import { NextResponse } from "next/server";

const LEAGUE = "PL";
const FOTMOB_LEAGUE_ID = 47;
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

function fotmobSeasonFromStartYear(startYear) {
  return `${startYear}/${startYear + 1}`;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bfc\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamCandidates(team) {
  const base = [
    team?.name,
    team?.shortName,
    team?.tla,
  ]
    .map((v) => normalizeName(v))
    .filter(Boolean);

  const aliasMap = {
    "tottenham hotspur": ["tottenham", "spurs"],
    "tottenham hotspur fc": ["tottenham", "spurs"],
    "wolverhampton wanderers": ["wolves"],
    "wolverhampton wanderers fc": ["wolves"],
    "manchester united": ["man utd", "manchester utd"],
    "manchester united fc": ["man utd", "manchester utd"],
    "manchester city": ["man city"],
    "manchester city fc": ["man city"],
    "newcastle united": ["newcastle"],
    "newcastle united fc": ["newcastle"],
    "nottingham forest": ["forest"],
    "nottingham forest fc": ["forest"],
    "brighton and hove albion": ["brighton"],
    "brighton and hove albion fc": ["brighton"],
    "west ham united": ["west ham"],
    "west ham united fc": ["west ham"],
    "afc bournemouth": ["bournemouth"],
  };

  const out = new Set(base);
  for (const name of base) {
    const aliases = aliasMap[name];
    if (!aliases) continue;
    for (const alias of aliases) out.add(normalizeName(alias));
  }
  return out;
}

function timeBucket(iso) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 60000);
}

function normalizeScoreStr(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function cleanStatusText(value) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNextData(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("FotMob page payload not found.");
  return JSON.parse(match[1]);
}

function countTeamRedCards(teamLineup) {
  const players = [
    ...(Array.isArray(teamLineup?.starters) ? teamLineup.starters : []),
    ...(Array.isArray(teamLineup?.subs) ? teamLineup.subs : []),
  ];
  let total = 0;
  for (const player of players) {
    const events = Array.isArray(player?.performance?.events) ? player.performance.events : [];
    for (const event of events) {
      const type = String(event?.type || "").trim();
      if (
        type === "redCard" ||
        type === "yellowRedCard" ||
        type === "secondYellowRedCard"
      ) {
        total += 1;
      }
    }
  }
  return total;
}

async function fetchMatchRedCards(pageUrl, forceRefresh) {
  if (!pageUrl) return null;
  try {
    const res = await fetch(`https://www.fotmob.com${String(pageUrl).split("#")[0]}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      ...(forceRefresh ? { cache: "no-store" } : { next: { revalidate: 20 } }),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const data = parseNextData(html);
    const content = data?.props?.pageProps?.content || {};
    const home = countTeamRedCards(content?.lineup?.homeTeam);
    const away = countTeamRedCards(content?.lineup?.awayTeam);
    if (!home && !away) return null;
    return { home, away };
  } catch {
    return null;
  }
}

function formatCountdown(msRemaining) {
  const safe = Math.max(0, msRemaining);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function halftimeLabel(fotmobStatus) {
  const kickoffMs = Date.parse(String(fotmobStatus?.utcTime || ""));
  if (!Number.isFinite(kickoffMs)) return "HT - 00:00";
  const firstHalfMinutes = Number(
    fotmobStatus?.liveTime?.basePeriod ?? fotmobStatus?.periodLength ?? 45,
  );
  const addedMinutes = Number(fotmobStatus?.liveTime?.addedTime ?? 0);
  const breakMinutes = 15;
  const restartMs =
    kickoffMs + (firstHalfMinutes + addedMinutes + breakMinutes) * 60 * 1000;
  const remaining = restartMs - Date.now();
  return `HT - ${formatCountdown(remaining)}`;
}

function isFotmobFinished(status) {
  return Boolean(status?.finished || status?.awarded);
}

function overlayStatus(providerStatus, fotmobStatus) {
  if (!fotmobStatus) return String(providerStatus || "");
  if (isFotmobFinished(fotmobStatus)) return "FINISHED";
  if (fotmobStatus.cancelled) return "CANCELLED";
  if (fotmobStatus.started) {
    const liveShort = cleanStatusText(fotmobStatus?.liveTime?.short);
    if (liveShort === "HT") return halftimeLabel(fotmobStatus);
    const reasonShort = cleanStatusText(fotmobStatus?.reason?.short);
    const combined = liveShort || reasonShort;
    return combined || "LIVE";
  }
  return String(providerStatus || "");
}

function buildFotmobIndex(matches) {
  const index = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    const round = Number(match?.roundName ?? match?.round);
    const kick = timeBucket(match?.status?.utcTime);
    const home = teamCandidates(match?.home);
    const away = teamCandidates(match?.away);
    const entry = {
      round,
      kick,
      home,
      away,
      pageUrl: match?.pageUrl || null,
      status: match?.status || null,
    };
    const key = `${round}|${kick ?? "na"}`;
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

function findFotmobMatch(index, fixture) {
  const round = Number(fixture?.gameweek);
  const kick = timeBucket(fixture?.kickoff);
  const key = `${round}|${kick ?? "na"}`;
  const candidates = index.get(key) || [];
  if (!candidates.length) return null;

  const homeNeedle = teamCandidates(fixture?.home);
  const awayNeedle = teamCandidates(fixture?.away);

  const matchesTeam = (needles, haystack) => {
    for (const n of needles) {
      if (haystack.has(n)) return true;
    }
    return false;
  };

  return (
    candidates.find(
      (candidate) =>
        matchesTeam(homeNeedle, candidate.home) &&
        matchesTeam(awayNeedle, candidate.away),
    ) || null
  );
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
  const gameweek = searchParams.get("gameweek");
  const forceRefresh =
    searchParams.get("refresh") === "1" || searchParams.has("t");
  const requestedSeason = searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const season = seasonStartYearFromKey(seasonKey);
  const fotmobSeason = fotmobSeasonFromStartYear(season);

  const url = gameweek
    ? `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${season}&matchday=${gameweek}`
    : `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${season}`;
  const fotmobUrl = `https://www.fotmob.com/api/leagues?id=${FOTMOB_LEAGUE_ID}&tab=fixtures&season=${encodeURIComponent(fotmobSeason)}`;

  let response;
  let fotmobResponse;
  try {
    [response, fotmobResponse] = await Promise.all([
      fetch(url, {
        headers: { "X-Auth-Token": API_KEY },
        ...(forceRefresh ? { cache: "no-store" } : { next: { revalidate: 60 } }),
      }),
      fetch(fotmobUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        ...(forceRefresh ? { cache: "no-store" } : { next: { revalidate: 30 } }),
      }).catch(() => null),
    ]);
  } catch {
    // Network/DNS/etc
    return NextResponse.json(
      { error: "Upstream fetch failed" },
      { status: 502 },
    );
  }

  // If matchday isn't available yet, don't blow up the UI — return empty.
  if (response.status === 400 || response.status === 404) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        seasonKey,
        fixtures: [],
        note: "No fixtures published for this gameweek yet.",
      },
      {
        status: 200,
        headers: forceRefresh
          ? { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
          : { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
      },
    );
  }

  if (response.status === 429) {
    const body = await response.text().catch(() => "");
    console.error("Football-Data rate limit:", body);
    return NextResponse.json(
      { error: "Football API rate limit", status: 429, retryAfterSec: 10 },
      {
        status: 429,
        headers: {
          "Retry-After": "10",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      },
    );
  }

  // Rate limit / auth errors should be visible as errors
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("Football-Data error:", response.status, body);
    return NextResponse.json(
      { error: "Football API error", status: response.status },
      { status: 502 },
    );
  }

  const data = await response.json();
  let fotmobIndex = new Map();
  if (fotmobResponse?.ok) {
    try {
      const fotmobData = await fotmobResponse.json();
      fotmobIndex = buildFotmobIndex(fotmobData?.fixtures?.allMatches);
    } catch (error) {
      console.warn("FotMob parse error:", error);
    }
  }

  const fixtures = await Promise.all((data.matches ?? []).map(async (match) => {
    const homeFT = match?.score?.fullTime?.home;
    const awayFT = match?.score?.fullTime?.away;
    const status = String(match?.status || "").toUpperCase();

    const hasFT =
      Number.isFinite(homeFT) && Number.isFinite(awayFT);

    const baseFixture = {
      fixtureId: match.id,
      gameweek: match.matchday,
      kickoff: match.utcDate,
      venue: match.venue ?? "TBD",
      status,
      home: {
        id: match.homeTeam.id,
        name: match.homeTeam.name,
        tla: match.homeTeam.tla || null,
        shortName:
          match.homeTeam.shortName ||
          match.homeTeam.tla ||
          match.homeTeam.name,
        badge: match.homeTeam.crest || null,
      },
      away: {
        id: match.awayTeam.id,
        name: match.awayTeam.name,
        tla: match.awayTeam.tla || null,
        shortName:
          match.awayTeam.shortName ||
          match.awayTeam.tla ||
          match.awayTeam.name,
        badge: match.awayTeam.crest || null,
      },

      // ✅ actual result (past gameweeks will populate automatically)
      result: hasFT ? `${homeFT}-${awayFT}` : null,

      // (optional) keep raw numbers if you prefer rendering without parsing
      resultFT: hasFT ? { home: homeFT, away: awayFT } : null,
    };

    const fotmobMatch = findFotmobMatch(fotmobIndex, baseFixture);
    if (!fotmobMatch?.status) return baseFixture;

    const fotmobScore = normalizeScoreStr(fotmobMatch.status.scoreStr);
    const mergedStatus = overlayStatus(baseFixture.status, fotmobMatch.status);

    return {
      ...baseFixture,
      status: mergedStatus,
      result: fotmobScore || baseFixture.result,
      resultFT: fotmobScore
        ? (() => {
            const [home, away] = fotmobScore.split("-").map(Number);
            return Number.isFinite(home) && Number.isFinite(away)
              ? { home, away }
              : baseFixture.resultFT;
          })()
        : baseFixture.resultFT,
      redCards:
        gameweek && fotmobMatch.status?.started && fotmobMatch.pageUrl
          ? await fetchMatchRedCards(fotmobMatch.pageUrl, forceRefresh)
          : null,
    };
  }));

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), seasonKey, fixtures },
    {
      headers: forceRefresh
        ? { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
        : { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    },
  );
}
