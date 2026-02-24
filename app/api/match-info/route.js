import { NextResponse } from "next/server";

function toScore(match) {
  const h = match?.score?.fullTime?.home;
  const a = match?.score?.fullTime?.away;
  if (!Number.isFinite(h) || !Number.isFinite(a)) return "—";
  return `${h}-${a}`;
}

function toFormResult(match, teamId) {
  const winner = String(match?.score?.winner || "").toUpperCase();
  if (winner === "DRAW") return "D";
  if (winner === "HOME_TEAM") return Number(match?.homeTeam?.id) === teamId ? "W" : "L";
  if (winner === "AWAY_TEAM") return Number(match?.awayTeam?.id) === teamId ? "W" : "L";
  const h = Number(match?.score?.fullTime?.home);
  const a = Number(match?.score?.fullTime?.away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return "—";
  if (h === a) return "D";
  const isHome = Number(match?.homeTeam?.id) === teamId;
  return (h > a) === isHome ? "W" : "L";
}

function mapMiniMatch(match) {
  return {
    id: Number(match?.id || 0) || null,
    utcDate: String(match?.utcDate || ""),
    homeTeam: {
      id: Number(match?.homeTeam?.id || 0) || null,
      name: String(match?.homeTeam?.name || "Home"),
      tla: match?.homeTeam?.tla ? String(match.homeTeam.tla) : null,
    },
    awayTeam: {
      id: Number(match?.awayTeam?.id || 0) || null,
      name: String(match?.awayTeam?.name || "Away"),
      tla: match?.awayTeam?.tla ? String(match.awayTeam.tla) : null,
    },
    competition: {
      name: String(match?.competition?.name || ""),
      code: match?.competition?.code ? String(match.competition.code) : null,
    },
    result: toScore(match),
    status: String(match?.status || ""),
  };
}

function byMostRecent(a, b) {
  const ta = Date.parse(String(a?.utcDate || ""));
  const tb = Date.parse(String(b?.utcDate || ""));
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
  if (!Number.isFinite(ta)) return 1;
  if (!Number.isFinite(tb)) return -1;
  return tb - ta;
}

function toYmdUtc(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req) {
  const API_KEY = process.env.FOOTBALLDATA_KEY;
  if (!API_KEY) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const fixtureId = Number(searchParams.get("fixtureId"));
  const homeTeamId = Number(searchParams.get("homeTeamId"));
  const awayTeamId = Number(searchParams.get("awayTeamId"));

  if (!Number.isFinite(fixtureId)) {
    return NextResponse.json({ error: "fixtureId is required" }, { status: 400 });
  }

  if (!Number.isFinite(homeTeamId) || !Number.isFinite(awayTeamId)) {
    return NextResponse.json(
      { error: "homeTeamId and awayTeamId are required" },
      { status: 400 },
    );
  }

  const now = new Date();
  const fiveYearsAgo = new Date(now);
  fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
  const dateFrom = toYmdUtc(fiveYearsAgo);
  const dateTo = toYmdUtc(now);

  const [h2hDirectRes, h2hFromHomeRes, homeFormRes, awayFormRes] = await Promise.allSettled([
    fetch(`https://api.football-data.org/v4/matches/${fixtureId}/head2head?limit=20`, {
      headers: { "X-Auth-Token": API_KEY },
      next: { revalidate: 900 },
    }),
    fetch(
      `https://api.football-data.org/v4/teams/${homeTeamId}/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=120`,
      {
        headers: { "X-Auth-Token": API_KEY },
        next: { revalidate: 900 },
      },
    ),
    fetch(`https://api.football-data.org/v4/teams/${homeTeamId}/matches?status=FINISHED&limit=7`, {
      headers: { "X-Auth-Token": API_KEY },
      next: { revalidate: 900 },
    }),
    fetch(`https://api.football-data.org/v4/teams/${awayTeamId}/matches?status=FINISHED&limit=7`, {
      headers: { "X-Auth-Token": API_KEY },
      next: { revalidate: 900 },
    }),
  ]);

  let headToHead = [];
  if (h2hDirectRes.status === "fulfilled" && h2hDirectRes.value?.ok) {
    const body = await h2hDirectRes.value.json().catch(() => ({}));
    const list = Array.isArray(body?.matches) ? body.matches : [];
    headToHead = list
      .filter((m) => Number(m?.id) !== fixtureId)
      .sort(byMostRecent)
      .slice(0, 5)
      .map(mapMiniMatch);
  }

  if (headToHead.length === 0 && h2hFromHomeRes.status === "fulfilled" && h2hFromHomeRes.value?.ok) {
    const body = await h2hFromHomeRes.value.json().catch(() => ({}));
    const list = Array.isArray(body?.matches) ? body.matches : [];
    headToHead = list
      .filter((m) => Number(m?.id) !== fixtureId)
      .filter((m) => {
        const hid = Number(m?.homeTeam?.id);
        const aid = Number(m?.awayTeam?.id);
        return hid === awayTeamId || aid === awayTeamId;
      })
      .sort(byMostRecent)
      .slice(0, 5)
      .map(mapMiniMatch);
  }

  const formFromResponse = async (resLike, teamId) => {
    if (resLike.status !== "fulfilled") return [];
    const response = resLike.value;
    if (!response?.ok) return [];
    const body = await response.json().catch(() => ({}));
    const list = Array.isArray(body?.matches) ? body.matches : [];
    return list
      .filter((m) => Number(m?.id) !== fixtureId)
      .slice(0, 5)
      .map((m) => ({
        ...mapMiniMatch(m),
        form: toFormResult(m, teamId),
      }))
      .sort(byMostRecent);
  };

  const [home, away] = await Promise.all([
    formFromResponse(homeFormRes, homeTeamId),
    formFromResponse(awayFormRes, awayTeamId),
  ]);

  return NextResponse.json(
    {
      fixtureId,
      generatedAt: new Date().toISOString(),
      headToHead,
      form: { home, away },
    },
    { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=300" } },
  );
}

