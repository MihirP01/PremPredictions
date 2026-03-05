import { NextResponse } from "next/server";

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

  const url = `https://api.football-data.org/v4/competitions/${LEAGUE}/standings?season=${season}`;
  const teamsUrl = `https://api.football-data.org/v4/competitions/${LEAGUE}/teams?season=${season}`;

  let response;
  let teamsResponse;
  try {
    [response, teamsResponse] = await Promise.all([
      fetch(url, {
        headers: { "X-Auth-Token": API_KEY },
        next: { revalidate: 300 },
      }),
      fetch(teamsUrl, {
        headers: { "X-Auth-Token": API_KEY },
        next: { revalidate: 300 },
      }),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Upstream fetch failed" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("Football-Data standings error:", response.status, body);
    return NextResponse.json(
      { error: "Football API error", status: response.status },
      { status: 502 },
    );
  }

  const data = await response.json();
  const teamsData = teamsResponse?.ok
    ? await teamsResponse.json().catch(() => ({}))
    : {};
  const tlaByTeamId = new Map(
    Array.isArray(teamsData?.teams)
      ? teamsData.teams.map((t) => [
          Number(t?.id),
          String(t?.tla || "").toUpperCase(),
        ])
      : [],
  );

  const mapRows = (rows = []) =>
    rows.map((row) => ({
      position: Number(row.position ?? 0),
      team: {
        name: row?.team?.name || "Club",
        tla: row?.team?.tla || tlaByTeamId.get(Number(row?.team?.id)) || null,
        shortName:
          row?.team?.shortName || row?.team?.tla || row?.team?.name || "Club",
        badge: row?.team?.crest || null,
      },
      playedGames: Number(row.playedGames ?? 0),
      won: Number(row.won ?? 0),
      draw: Number(row.draw ?? 0),
      lost: Number(row.lost ?? 0),
      goalsScored: Number(row.goalsFor ?? 0),
      goalsAgainst: Number(row.goalsAgainst ?? 0),
      goalDifference: Number(row.goalDifference ?? 0),
      points: Number(row.points ?? 0),
    }));

  const standingsTotal = mapRows(
    data?.standings?.find((s) => s?.type === "TOTAL")?.table ||
      data?.standings?.[0]?.table ||
      [],
  );
  const standingsHome = mapRows(
    data?.standings?.find((s) => s?.type === "HOME")?.table || [],
  );
  const standingsAway = mapRows(
    data?.standings?.find((s) => s?.type === "AWAY")?.table || [],
  );

  return NextResponse.json(
    { seasonKey, standingsTotal, standingsHome, standingsAway },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } },
  );
}
