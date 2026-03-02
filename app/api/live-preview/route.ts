import { NextRequest, NextResponse } from "next/server";

const FOTMOB_LEAGUE_ID = 47;
const SEASON_START_MONTH_UTC = 7;

type FotmobStatus = {
  utcTime?: string;
  started?: boolean;
  finished?: boolean;
  awarded?: boolean;
  cancelled?: boolean;
  scoreStr?: string;
  reason?: { short?: string };
  liveTime?: {
    short?: string;
    basePeriod?: number;
    addedTime?: number;
  };
  periodLength?: number;
};

type FotmobTeam = {
  id?: number;
  name?: string;
  shortName?: string;
};

type FotmobMatch = {
  id?: number;
  round?: number | string;
  roundName?: number | string;
  home?: FotmobTeam;
  away?: FotmobTeam;
  status?: FotmobStatus;
};

function inferSeasonKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= SEASON_START_MONTH_UTC ? year : year - 1;
  const yyStart = String(startYear % 100).padStart(2, "0");
  const yyEnd = String((startYear + 1) % 100).padStart(2, "0");
  return `${yyStart}${yyEnd}`;
}

function normalizeSeasonKey(input: unknown) {
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

function seasonStartYearFromKey(seasonKey: string) {
  return 2000 + Number(String(seasonKey).slice(0, 2));
}

function fotmobSeasonFromStartYear(startYear: number) {
  return `${startYear}/${startYear + 1}`;
}

function cleanStatusText(value: unknown) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScoreStr(value: unknown) {
  const m = String(value || "")
    .trim()
    .match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function formatCountdown(msRemaining: number) {
  const safe = Math.max(0, msRemaining);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function halftimeLabel(status: FotmobStatus | undefined) {
  const kickoffMs = Date.parse(String(status?.utcTime || ""));
  if (!Number.isFinite(kickoffMs)) return "HT - 00:00";
  const firstHalfMinutes = Number(status?.liveTime?.basePeriod ?? status?.periodLength ?? 45);
  const addedMinutes = Number(status?.liveTime?.addedTime ?? 0);
  const restartMs = kickoffMs + (firstHalfMinutes + addedMinutes + 15) * 60 * 1000;
  return `HT - ${formatCountdown(restartMs - Date.now())}`;
}

function isFotmobFinished(status: FotmobStatus | undefined) {
  return Boolean(status?.finished || status?.awarded);
}

function overlayStatus(providerStatus: string, fotmobStatus: FotmobStatus | undefined) {
  if (!fotmobStatus) return String(providerStatus || "TIMED");
  if (isFotmobFinished(fotmobStatus)) return "FINISHED";
  if (fotmobStatus.cancelled) return "CANCELLED";
  if (fotmobStatus.started) {
    const liveShort = cleanStatusText(fotmobStatus?.liveTime?.short);
    if (liveShort === "HT") return halftimeLabel(fotmobStatus);
    const reasonShort = cleanStatusText(fotmobStatus?.reason?.short);
    return liveShort || reasonShort || "LIVE";
  }
  return String(providerStatus || "TIMED");
}

function mapMatchToOverlay(match: FotmobMatch, forcedGameweek: number | null) {
  const result = normalizeScoreStr(match?.status?.scoreStr);
  return {
    fixtureId: Number(match?.id || 0) || null,
    gameweek:
      forcedGameweek ??
      (Number.isFinite(Number(match?.roundName ?? match?.round))
        ? Number(match?.roundName ?? match?.round)
        : null),
    kickoff: String(match?.status?.utcTime || ""),
    status: overlayStatus("TIMED", match?.status),
    home: {
      id: Number(match?.home?.id || 0) || null,
      name: String(match?.home?.name || "Home"),
      tla: match?.home?.shortName ? String(match.home.shortName) : null,
      shortName:
        (match?.home?.shortName ? String(match.home.shortName) : null) ||
        String(match?.home?.name || "Home"),
      badge:
        Number(match?.home?.id || 0) > 0
          ? `https://images.fotmob.com/image_resources/logo/teamlogo/${Number(match?.home?.id)}.png`
          : null,
    },
    away: {
      id: Number(match?.away?.id || 0) || null,
      name: String(match?.away?.name || "Away"),
      tla: match?.away?.shortName ? String(match.away.shortName) : null,
      shortName:
        (match?.away?.shortName ? String(match.away.shortName) : null) ||
        String(match?.away?.name || "Away"),
      badge:
        Number(match?.away?.id || 0) > 0
          ? `https://images.fotmob.com/image_resources/logo/teamlogo/${Number(match?.away?.id)}.png`
          : null,
    },
    result,
  };
}

export async function GET(req: NextRequest) {
  const gameweekParam = req.nextUrl.searchParams.get("gameweek");
  const requestedSeason = req.nextUrl.searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const season = fotmobSeasonFromStartYear(seasonStartYearFromKey(seasonKey));
  const gameweek = Number.isFinite(Number(gameweekParam)) ? Number(gameweekParam) : null;

  const url = `https://www.fotmob.com/api/leagues?id=${FOTMOB_LEAGUE_ID}&tab=fixtures&season=${encodeURIComponent(season)}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "FotMob fetch failed", status: response.status },
        { status: 502 },
      );
    }

    const data = await response.json().catch(() => null);
    const matches = Array.isArray(data?.fixtures?.allMatches)
      ? (data.fixtures.allMatches as FotmobMatch[])
      : [];

    const filtered = gameweek == null
      ? matches
      : matches.filter((match) => Number(match?.roundName ?? match?.round) === gameweek);

    return NextResponse.json(
      {
        seasonKey,
        source: "fotmob",
        generatedAt: new Date().toISOString(),
        fixtures: filtered.map((match) => mapMatchToOverlay(match, gameweek)),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load live preview",
      },
      { status: 502 },
    );
  }
}
