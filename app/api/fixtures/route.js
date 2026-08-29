import { NextResponse } from "next/server";
import { getFotmobLeagueMatches } from "@/lib/fotmobLeague";
import { getPostgresPool } from "@/lib/server/postgres";

const LEAGUE = "PL";
const SEASON_START_MONTH_UTC = 7; // Aug

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

function teamBadgeUrl(teamId) {
  const id = Number(teamId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
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
  const base = [team?.name, team?.shortName, team?.tla]
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
    const events = Array.isArray(player?.performance?.events)
      ? player.performance.events
      : [];
    for (const event of events) {
      const type = String(event?.type || "")
        .trim()
        .toLowerCase();
      if (
        type === "redcard" ||
        type === "yellowredcard" ||
        type === "secondyellowredcard" ||
        type === "secondyellow"
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
    const res = await fetch(
      `https://www.fotmob.com${String(pageUrl).split("#")[0]}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        ...(forceRefresh
          ? { cache: "no-store" }
          : { next: { revalidate: 20 } }),
      },
    );
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
  const reasonShort = cleanStatusText(fotmobStatus?.reason?.short);
  if (/^FT$/i.test(reasonShort) || /full\s*time/i.test(reasonShort)) {
    return "FINISHED";
  }
  if (fotmobStatus.cancelled) return "CANCELLED";
  if (fotmobStatus.started) {
    const liveShort = cleanStatusText(fotmobStatus?.liveTime?.short);
    if (liveShort === "HT") return halftimeLabel(fotmobStatus);
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

function fallbackFixtureFromFotmob(match, forceGameweek) {
  const result = normalizeScoreStr(match?.status?.scoreStr);
  const resultFT =
    result != null
      ? (() => {
          const [home, away] = result.split("-").map(Number);
          return Number.isFinite(home) && Number.isFinite(away)
            ? { home, away }
            : null;
        })()
      : null;

  return {
    fixtureId: Number(match?.id || 0) || null,
    gameweek: Number.isFinite(Number(forceGameweek))
      ? Number(forceGameweek)
      : Number(match?.roundName ?? match?.round) || null,
    kickoff: String(match?.status?.utcTime || ""),
    venue: "TBD",
    status: overlayStatus("TIMED", match?.status),
    home: {
      id: Number(match?.home?.id || 0) || null,
      name: String(match?.home?.name || "Home"),
      tla: match?.home?.shortName ? String(match.home.shortName) : null,
      shortName:
        (match?.home?.shortName ? String(match.home.shortName) : null) ||
        String(match?.home?.name || "Home"),
      badge: teamBadgeUrl(match?.home?.id),
    },
    away: {
      id: Number(match?.away?.id || 0) || null,
      name: String(match?.away?.name || "Away"),
      tla: match?.away?.shortName ? String(match.away.shortName) : null,
      shortName:
        (match?.away?.shortName ? String(match.away.shortName) : null) ||
        String(match?.away?.name || "Away"),
      badge: teamBadgeUrl(match?.away?.id),
    },
    result,
    resultFT,
  };
}

async function persistFixtures(seasonKey, gameweek, payload) {
  const gw = Number(gameweek);
  if (!Number.isInteger(gw) || !Array.isArray(payload?.fixtures) || !payload.fixtures.length) return;
  await getPostgresPool().query(
    `INSERT INTO fixture_snapshots
       (season_key, gameweek, fixtures, source, generated_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, now())
     ON CONFLICT (season_key, gameweek) DO UPDATE SET
       fixtures = EXCLUDED.fixtures,
       source = EXCLUDED.source,
       generated_at = EXCLUDED.generated_at,
       updated_at = now()`,
    [seasonKey, gw, JSON.stringify(payload.fixtures), payload.source || "football-data", payload.generatedAt || new Date().toISOString()],
  );
}

async function storedFixtures(seasonKey, gameweek) {
  const gw = Number(gameweek);
  if (!Number.isInteger(gw)) return null;
  const result = await getPostgresPool().query(
    `SELECT fixtures, source, generated_at FROM fixture_snapshots
      WHERE season_key = $1 AND gameweek = $2 LIMIT 1`,
    [seasonKey, gw],
  );
  const row = result.rows[0];
  if (!row || !Array.isArray(row.fixtures) || !row.fixtures.length) return null;
  return {
    fixtures: row.fixtures,
    source: `${row.source || "provider"}-postgres-fallback`,
    generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : null,
    stale: true,
  };
}

async function fixtureResponse(seasonKey, gameweek, payload, init) {
  await persistFixtures(seasonKey, gameweek, payload).catch((error) => {
    console.error("Fixture snapshot write failed", error);
  });
  return NextResponse.json(payload, init);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const gameweek = searchParams.get("gameweek");
  const forceRefresh =
    searchParams.get("refresh") === "1" || searchParams.has("t");
  const requestedSeason = searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const season = seasonStartYearFromKey(seasonKey);
  const fotmobSeason = fotmobSeasonFromStartYear(season);
  const API_KEY = process.env.FOOTBALLDATA_KEY;
  if (!API_KEY) {
    const stored = await storedFixtures(seasonKey, gameweek).catch(() => null);
    return stored
      ? NextResponse.json(stored, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const url = gameweek
    ? `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${season}&matchday=${gameweek}`
    : `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${season}`;
  let response;
  let fotmobMatches = [];
  try {
    [response, fotmobMatches] = await Promise.all([
      fetch(url, {
        headers: { "X-Auth-Token": API_KEY },
        ...(forceRefresh
          ? { cache: "no-store" }
          : { next: { revalidate: 60 } }),
      }),
      getFotmobLeagueMatches(fotmobSeason, { force: forceRefresh }).catch(
        () => [],
      ),
    ]);
  } catch {
    const stored = await storedFixtures(seasonKey, gameweek).catch(() => null);
    return stored
      ? NextResponse.json(stored, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  const fotmobIndex = buildFotmobIndex(fotmobMatches);
  const selectedFotmobMatches = gameweek
    ? fotmobMatches.filter(
        (match) =>
          Number(match?.roundName ?? match?.round) === Number(gameweek),
      )
    : fotmobMatches;

  const buildFotmobFallbackFixtures = async () =>
    Promise.all(
      selectedFotmobMatches.map(async (match) => {
        const baseFixture = fallbackFixtureFromFotmob(match, gameweek);
        return {
          ...baseFixture,
          redCards:
            gameweek && match?.status?.started && match?.pageUrl
              ? await fetchMatchRedCards(match.pageUrl, forceRefresh)
              : null,
        };
      }),
    );

  // If matchday isn't available yet, don't blow up the UI — return empty.
  if (response.status === 400 || response.status === 404) {
    if (selectedFotmobMatches.length > 0) {
      const fixtures = await buildFotmobFallbackFixtures();
      return fixtureResponse(
        seasonKey,
        gameweek,
        {
          generatedAt: new Date().toISOString(),
          seasonKey,
          fixtures,
          source: "fotmob-fallback",
        },
        {
          status: 200,
          headers: forceRefresh
            ? {
                "Cache-Control":
                  "no-store, no-cache, must-revalidate, max-age=0",
              }
            : { "Cache-Control": "s-maxage=20, stale-while-revalidate=15" },
        },
      );
    }
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
          ? {
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            }
          : { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
      },
    );
  }

  if (response.status === 429) {
    const body = await response.text().catch(() => "");
    console.error("Football-Data rate limit:", body);
    if (selectedFotmobMatches.length > 0) {
      const fixtures = await buildFotmobFallbackFixtures();
      return fixtureResponse(
        seasonKey,
        gameweek,
        {
          generatedAt: new Date().toISOString(),
          seasonKey,
          fixtures,
          source: "fotmob-fallback",
        },
        {
          status: 200,
          headers: forceRefresh
            ? {
                "Cache-Control":
                  "no-store, no-cache, must-revalidate, max-age=0",
              }
            : { "Cache-Control": "s-maxage=20, stale-while-revalidate=15" },
        },
      );
    }
    const stored = await storedFixtures(seasonKey, gameweek).catch(() => null);
    if (stored) return NextResponse.json(stored, { headers: { "Cache-Control": "no-store" } });
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
    if (selectedFotmobMatches.length > 0) {
      const fixtures = await buildFotmobFallbackFixtures();
      return fixtureResponse(
        seasonKey,
        gameweek,
        {
          generatedAt: new Date().toISOString(),
          seasonKey,
          fixtures,
          source: "fotmob-fallback",
        },
        {
          status: 200,
          headers: forceRefresh
            ? {
                "Cache-Control":
                  "no-store, no-cache, must-revalidate, max-age=0",
              }
            : { "Cache-Control": "s-maxage=20, stale-while-revalidate=15" },
        },
      );
    }
    const stored = await storedFixtures(seasonKey, gameweek).catch(() => null);
    if (stored) return NextResponse.json(stored, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(
      { error: "Football API error", status: response.status },
      { status: 502 },
    );
  }

  const data = await response.json();

  const fixtures = await Promise.all(
    (data.matches ?? []).map(async (match) => {
      const homeFT = match?.score?.fullTime?.home;
      const awayFT = match?.score?.fullTime?.away;
      const status = String(match?.status || "").toUpperCase();

      const hasFT = Number.isFinite(homeFT) && Number.isFinite(awayFT);
      const liveHome = match?.score?.regularTime?.home ?? match?.score?.halfTime?.home;
      const liveAway = match?.score?.regularTime?.away ?? match?.score?.halfTime?.away;
      const hasLiveScore =
        !hasFT &&
        Number.isFinite(liveHome) &&
        Number.isFinite(liveAway) &&
        (status === "IN_PLAY" || status === "PAUSED" || status === "LIVE");

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
        result: hasFT
          ? `${homeFT}-${awayFT}`
          : hasLiveScore
            ? `${liveHome}-${liveAway}`
            : null,

        resultFT: hasFT
          ? { home: homeFT, away: awayFT }
          : hasLiveScore
            ? { home: liveHome, away: liveAway }
            : null,
      };

      const fotmobMatch = findFotmobMatch(fotmobIndex, baseFixture);
      if (!fotmobMatch?.status) return baseFixture;

      const fotmobScore = normalizeScoreStr(fotmobMatch.status.scoreStr);
      const mergedStatus = overlayStatus(
        baseFixture.status,
        fotmobMatch.status,
      );

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
    }),
  );

  return fixtureResponse(
    seasonKey,
    gameweek,
    { generatedAt: new Date().toISOString(), seasonKey, fixtures },
    {
      headers: forceRefresh
        ? { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
        : { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    },
  );
}
