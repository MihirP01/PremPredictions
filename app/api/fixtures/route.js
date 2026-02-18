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
  const requestedSeason = searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const season = seasonStartYearFromKey(seasonKey);

  const url = gameweek
    ? `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${season}&matchday=${gameweek}`
    : `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${season}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { "X-Auth-Token": API_KEY },
      next: { revalidate: 60 },
    });
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
        headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
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

  const fixtures = (data.matches ?? []).map((match) => {
    const homeFT = match?.score?.fullTime?.home;
    const awayFT = match?.score?.fullTime?.away;

    const hasFT =
      Number.isFinite(homeFT) &&
      Number.isFinite(awayFT) &&
      match.status === "FINISHED";

    return {
      fixtureId: match.id,
      gameweek: match.matchday,
      kickoff: match.utcDate,
      venue: match.venue ?? "TBD",
      status: match.status,
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
  });

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), seasonKey, fixtures },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" } },
  );
}
