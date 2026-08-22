import { NextResponse } from "next/server";
import { getFotmobLeagueMatches } from "@/lib/fotmobLeague";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
};

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
    .replace(/\bac\b/g, "")
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
    "manchester city": ["man city"],
    "newcastle united": ["newcastle"],
    "nottingham forest": ["forest"],
    "brighton and hove albion": ["brighton"],
    "west ham united": ["west ham"],
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

function buildLeagueIndex(matches) {
  const index = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    const kick = timeBucket(match?.status?.utcTime);
    const home = teamCandidates(match?.home);
    const away = teamCandidates(match?.away);
    const key = `${kick ?? "na"}`;
    const row = {
      id: Number(match?.id || 0) || null,
      pageUrl: String(match?.pageUrl || ""),
      home,
      away,
      status: match?.status || null,
    };
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function matchesTeam(needles, haystack) {
  for (const n of needles) {
    if (haystack.has(n)) return true;
  }
  return false;
}

function findLeagueMatch(index, fixture) {
  const kick = timeBucket(fixture?.kickoff);
  const candidates = index.get(`${kick ?? "na"}`) || [];
  const homeNeedle = teamCandidates(fixture?.homeTeam);
  const awayNeedle = teamCandidates(fixture?.awayTeam);
  return (
    candidates.find(
      (candidate) =>
        matchesTeam(homeNeedle, candidate.home) &&
        matchesTeam(awayNeedle, candidate.away),
    ) || null
  );
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScore(value) {
  const m = cleanText(value).match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return "—";
  return `${m[1]}-${m[2]}`;
}

function parseNextData(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("FotMob page payload not found.");
  return JSON.parse(match[1]);
}

function parseNextDataSafe(html) {
  try {
    return parseNextData(html);
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&amp;/g, "&");
}

function extractLiveWidgetUrl(html) {
  const match = String(html || "").match(
    /<iframe[^>]*title="superLive"[^>]*src="([^"]+)"/i,
  );
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1]);
}

function absoluteFotmobUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `https://www.fotmob.com${raw}`;
  return `https://www.fotmob.com/${raw.replace(/^\/+/, "")}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Accept: "application/json, text/plain, */*",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`FotMob JSON ${res.status}`);
  }
  return res.json();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`FotMob HTML ${res.status}`);
  }
  return res.text();
}

function teamBadgeUrl(teamId) {
  const id = Number(teamId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

function playerImageUrl(playerId) {
  const id = Number(playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
}

function positionLabelFromId(positionId) {
  const id = Number(positionId);
  if (id === 0) return "GK";
  if (id === 1) return "DEF";
  if (id === 2) return "MID";
  if (id === 3) return "FWD";
  return "—";
}

function toMiniTeam(team, badge) {
  return {
    id: Number(team?.id || 0) || null,
    name: String(team?.name || "Team"),
    tla: team?.shortName ? String(team.shortName) : null,
    shortName: team?.shortName ? String(team.shortName) : null,
    badge: badge ? String(badge) : teamBadgeUrl(team?.id),
  };
}

function toMiniMatch(match) {
  const competitionCode = cleanText(
    match?.league?.shortName ||
      match?.tournament?.shortName ||
      match?.series?.shortName ||
      "",
  );
  return {
    id: Number(match?.id || match?.matchId || 0) || null,
    utcDate: String(match?.status?.utcTime || match?.time?.utcTime || ""),
    homeTeam: toMiniTeam(match?.home, null),
    awayTeam: toMiniTeam(match?.away, null),
    competition: {
      name: String(match?.league?.name || match?.tournament?.name || ""),
      code: competitionCode || null,
      emblem: null,
    },
    result: normalizeScore(match?.status?.scoreStr),
    status: cleanText(
      match?.status?.reason?.short || match?.status?.liveTime?.short || "",
    ),
  };
}

function toFormResult(match, teamId) {
  const h = Number(match?.home?.score);
  const a = Number(match?.away?.score);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return "—";
  if (h === a) return "D";
  const winnerId = h > a ? Number(match?.home?.id) : Number(match?.away?.id);
  return winnerId === teamId ? "W" : "L";
}

function mapPlayer(player) {
  const tags = [];
  const events = Array.isArray(player?.performance?.events)
    ? player.performance.events
    : [];
  let goalCount = 0;
  let ownGoalCount = 0;
  let assistCount = 0;
  let yellowCardCount = 0;
  let redCardCount = 0;
  let sawSecondYellowRed = false;
  for (const event of events) {
    const rawType = String(event?.type || "").trim();
    const type = rawType.toLowerCase();
    if (!type) continue;
    if (type === "yellowcard") yellowCardCount += 1;
    else if (type === "redcard") redCardCount += 1;
    else if (
      type === "yellowredcard" ||
      type === "secondyellowredcard" ||
      type === "secondyellow"
    ) {
      sawSecondYellowRed = true;
      yellowCardCount += 1;
      redCardCount += 1;
    } else if (type === "goal" || type === "penaltygoal") goalCount += 1;
    else if (type === "owngoal") ownGoalCount += 1;
    else if (type === "assist") assistCount += 1;
    else tags.push(rawType);
  }
  if (sawSecondYellowRed) {
    yellowCardCount = Math.min(Math.max(yellowCardCount, 1), 1);
    redCardCount = Math.max(redCardCount, 1);
  }
  return {
    id: Number(player?.id || 0) || null,
    name: String(player?.name || "Player"),
    shirtNumber: player?.shirtNumber ? String(player.shirtNumber) : null,
    positionId: Number.isFinite(Number(player?.positionId))
      ? Number(player.positionId)
      : null,
    photo: playerImageUrl(player?.id),
    layout:
      Number.isFinite(Number(player?.verticalLayout?.x)) &&
      Number.isFinite(Number(player?.verticalLayout?.y))
        ? {
            x: Number(player.verticalLayout.x),
            y: Number(player.verticalLayout.y),
          }
        : null,
    positionLabel: positionLabelFromId(player?.usualPlayingPositionId),
    rating: Number.isFinite(Number(player?.performance?.rating))
      ? Number(player.performance.rating)
      : null,
    goalCount,
    ownGoalCount,
    assistCount,
    yellowCardCount,
    redCardCount,
    countryCode: player?.countryCode ? String(player.countryCode) : null,
    statusTags: tags,
    substitutionEvents: Array.isArray(player?.performance?.substitutionEvents)
      ? player.performance.substitutionEvents.map((event) => ({
          time: Number.isFinite(Number(event?.time))
            ? Number(event.time)
            : null,
          type: cleanText(event?.type),
        }))
      : [],
  };
}

function mapLineupTeam(team) {
  return {
    id: Number(team?.id || 0) || null,
    name: String(team?.name || "Team"),
    formation: team?.formation ? String(team.formation) : null,
    coach: team?.coach?.name ? String(team.coach.name) : null,
    starters: Array.isArray(team?.starters) ? team.starters.map(mapPlayer) : [],
    subs: Array.isArray(team?.subs) ? team.subs.map(mapPlayer) : [],
    unavailable: Array.isArray(team?.unavailable)
      ? team.unavailable.map(mapPlayer)
      : [],
  };
}

function extractTopStats(statsRoot) {
  const groups = Array.isArray(statsRoot?.Periods?.All?.stats)
    ? statsRoot.Periods.All.stats
    : [];
  const preferred =
    groups.find((group) => String(group?.key || "") === "top_stats") ||
    groups[0] ||
    null;
  const stats = Array.isArray(preferred?.stats) ? preferred.stats : [];
  return stats
    .filter(
      (row) =>
        Array.isArray(row?.stats) &&
        row.stats.length >= 2 &&
        row?.type !== "title",
    )
    .slice(0, 8)
    .map((row) => ({
      label: String(row?.title || "Stat"),
      home: String(row.stats[0] ?? "—"),
      away: String(row.stats[1] ?? "—"),
      highlighted:
        row?.highlighted === "home" ||
        row?.highlighted === "away" ||
        row?.highlighted === "equal"
          ? row.highlighted
          : null,
    }));
}

async function extractLiveWidgetTopStats(liveWidgetUrl) {
  const abs = absoluteFotmobUrl(liveWidgetUrl);
  if (!abs) return null;
  try {
    const html = await fetchHtml(abs);
    const nextData = parseNextDataSafe(html);
    if (!nextData) return null;
    const pageProps = nextData?.props?.pageProps || {};
    const candidateRoots = [
      pageProps?.content?.stats,
      pageProps?.stats,
      pageProps?.data?.stats,
      pageProps?.match?.content?.stats,
      pageProps?.fallback?.stats,
    ];
    for (const root of candidateRoots) {
      const rows = extractTopStats(root);
      if (rows.length) return rows;
    }
    return null;
  } catch {
    return null;
  }
}

function extractTeamFallback(nextData, teamId) {
  const fallback = nextData?.props?.pageProps?.fallback || {};
  return fallback[`team-${teamId}`] || null;
}

function extractRecentForm(teamData, excludeMatchId, teamId) {
  const list = teamData?.fixtures?.allFixtures?.fixtures;
  if (!Array.isArray(list)) return [];
  return list
    .filter((match) => Number(match?.id) !== excludeMatchId)
    .filter((match) =>
      Boolean(match?.status?.finished || match?.status?.awarded),
    )
    .sort(
      (a, b) =>
        Date.parse(String(b?.status?.utcTime || 0)) -
        Date.parse(String(a?.status?.utcTime || 0)),
    )
    .slice(0, 5)
    .map((match) => ({
      ...toMiniMatch(match),
      form: toFormResult(match, teamId),
    }));
}

function deriveLineupPhase(kickoff) {
  const kickoffMs = Date.parse(String(kickoff || ""));
  if (!Number.isFinite(kickoffMs)) return "confirmed";
  const predictionWindowStartMs = kickoffMs - 75 * 60 * 1000;
  return Date.now() < predictionWindowStartMs ? "predicted" : "confirmed";
}

function isLiveLeagueStatus(status) {
  return Boolean(
    status &&
    status.started &&
    !status.finished &&
    !status.awarded &&
    !status.cancelled,
  );
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const fixtureId = Number(searchParams.get("fixtureId"));
  const seasonKey = normalizeSeasonKey(searchParams.get("seasonKey"));
  const kickoff = String(searchParams.get("kickoff") || "");
  const homeName = String(searchParams.get("homeName") || "");
  const awayName = String(searchParams.get("awayName") || "");
  const homeTla = searchParams.get("homeTla");
  const awayTla = searchParams.get("awayTla");
  const homeShortName = searchParams.get("homeShortName");
  const awayShortName = searchParams.get("awayShortName");

  if (!Number.isFinite(fixtureId)) {
    return NextResponse.json(
      { error: "fixtureId is required" },
      { status: 400 },
    );
  }
  if (!seasonKey || !kickoff || !homeName || !awayName) {
    return NextResponse.json(
      { error: "seasonKey, kickoff, homeName and awayName are required" },
      { status: 400 },
    );
  }

  try {
    const season = fotmobSeasonFromStartYear(seasonStartYearFromKey(seasonKey));
    const leagueMatches = await getFotmobLeagueMatches(season);
    const leagueIndex = buildLeagueIndex(leagueMatches);
    const leagueMatch = findLeagueMatch(leagueIndex, {
      kickoff,
      homeTeam: { name: homeName, tla: homeTla, shortName: homeShortName },
      awayTeam: { name: awayName, tla: awayTla, shortName: awayShortName },
    });

    if (!leagueMatch?.pageUrl) {
      return NextResponse.json(
        { error: "Match not found on FotMob." },
        { status: 404 },
      );
    }

    const matchUrl = `https://www.fotmob.com${leagueMatch.pageUrl.split("#")[0]}`;
    const matchHtml = await fetchHtml(matchUrl);
    const matchData = parseNextData(matchHtml);
    const pageProps = matchData?.props?.pageProps || {};
    const header = pageProps?.header || {};
    const content = pageProps?.content || {};
    const headerTeams = Array.isArray(header?.teams) ? header.teams : [];
    const homeHeaderTeam = headerTeams[0] || {};
    const awayHeaderTeam = headerTeams[1] || {};

    const teamResults = await Promise.allSettled(
      headerTeams
        .slice(0, 2)
        .map((team) =>
          team?.pageUrl
            ? fetchHtml(
                `https://www.fotmob.com${String(team.pageUrl).split("#")[0]}`,
              )
            : Promise.resolve(""),
        ),
    );

    const homeTeamPage =
      teamResults[0]?.status === "fulfilled" && teamResults[0].value
        ? parseNextDataSafe(teamResults[0].value)
        : null;
    const awayTeamPage =
      teamResults[1]?.status === "fulfilled" && teamResults[1].value
        ? parseNextDataSafe(teamResults[1].value)
        : null;

    const homeTeamData = extractTeamFallback(
      homeTeamPage,
      Number(homeHeaderTeam?.id || 0),
    );
    const awayTeamData = extractTeamFallback(
      awayTeamPage,
      Number(awayHeaderTeam?.id || 0),
    );

    const headToHead = Array.isArray(content?.h2h?.matches)
      ? content.h2h.matches.slice(0, 5).map(toMiniMatch)
      : [];

    const lineups = {
      phase: deriveLineupPhase(kickoff),
      home: mapLineupTeam(content?.lineup?.homeTeam),
      away: mapLineupTeam(content?.lineup?.awayTeam),
    };

    const liveWidgetUrl = isLiveLeagueStatus(leagueMatch?.status)
      ? extractLiveWidgetUrl(matchHtml)
      : null;

    let stats = extractTopStats(content?.stats);
    if (liveWidgetUrl) {
      const liveWidgetStats = await extractLiveWidgetTopStats(liveWidgetUrl);
      if (liveWidgetStats?.length) {
        stats = liveWidgetStats;
      }
    }

    const form = {
      home: extractRecentForm(
        homeTeamData,
        Number(leagueMatch?.id || 0),
        Number(homeHeaderTeam?.id || lineups.home.id || 0),
      ),
      away: extractRecentForm(
        awayTeamData,
        Number(leagueMatch?.id || 0),
        Number(awayHeaderTeam?.id || lineups.away.id || 0),
      ),
    };

    const cacheControl = isLiveLeagueStatus(leagueMatch?.status)
      ? "no-store"
      : "s-maxage=300, stale-while-revalidate=120";

    return NextResponse.json(
      {
        fixtureId,
        generatedAt: new Date().toISOString(),
        lineups,
        stats,
        headToHead,
        form,
        liveWidgetUrl,
      },
      {
        headers: {
          "Cache-Control": cacheControl,
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load match info.",
      },
      { status: 502 },
    );
  }
}
