import { NextResponse } from "next/server";

const LEAGUE = "PL";
const SEASON = 2025;

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

  const url = gameweek
    ? `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${SEASON}&matchday=${gameweek}`
    : `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${SEASON}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { "X-Auth-Token": API_KEY },
      next: { revalidate: 60 },
    });
  } catch (e) {
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
      home: { id: match.homeTeam.id, name: match.homeTeam.name },
      away: { id: match.awayTeam.id, name: match.awayTeam.name },

      // ✅ actual result (past gameweeks will populate automatically)
      result: hasFT ? `${homeFT}-${awayFT}` : null,

      // (optional) keep raw numbers if you prefer rendering without parsing
      resultFT: hasFT ? { home: homeFT, away: awayFT } : null,
    };
  });

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), fixtures },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" } },
  );
}
