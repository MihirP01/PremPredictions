import { NextResponse } from "next/server";

const FOTMOB_LIGUE_1_ID = 53;
const TARGET_HOME = normalizeName("Paris Saint-Germain");
const TARGET_AWAY = normalizeName("Le Havre");

function normalizeName(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bfc\b/g, "")
    .replace(/\bac\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTargetFixture(match: any) {
  const home = normalizeName(match?.home?.name);
  const away = normalizeName(match?.away?.name);
  return (
    (home === TARGET_HOME && away === TARGET_AWAY) ||
    (home === TARGET_AWAY && away === TARGET_HOME)
  );
}

function cleanLiveText(value: unknown) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCountdown(msRemaining: number) {
  const safe = Math.max(0, msRemaining);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function halftimeLabel(status: any) {
  const kickoffMs = Date.parse(String(status?.utcTime || ""));
  if (!Number.isFinite(kickoffMs)) return "HT - 00:00";
  const firstHalfMinutes = Number(
    status?.liveTime?.basePeriod ?? status?.periodLength ?? 45,
  );
  const addedMinutes = Number(status?.liveTime?.addedTime ?? 0);
  const restartMs =
    kickoffMs + (firstHalfMinutes + addedMinutes + 15) * 60 * 1000;
  const remaining = restartMs - Date.now();
  return `HT - ${formatCountdown(remaining)}`;
}

function ordinalSuffix(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = day % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

function formatPreviewDate(iso: string) {
  const date = new Date(iso);
  const timeZone = "Europe/London";
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
  }).format(date);
  const dayNum = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
    }).format(date),
  );
  const month = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    month: "short",
  }).format(date);
  const year = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return {
    dayLabel: weekday,
    dayNum,
    suffix: ordinalSuffix(dayNum),
    monthYear: `${month} ${year}`,
    time,
  };
}

function liveLabelFor(status: any) {
  if (!status) return "LIVE";
  if (status.finished || status.awarded) return "FT";
  const liveShort = cleanLiveText(status?.liveTime?.short);
  if (liveShort === "HT") return `LIVE • ${halftimeLabel(status)}`;
  if (liveShort) return `LIVE • ${liveShort}`;
  const reasonShort = cleanLiveText(status?.reason?.short);
  if (reasonShort) return `LIVE • ${reasonShort}`;
  return "LIVE";
}

function liveStateParts(status: any) {
  if (!status) {
    return {
      statusHeading: "Scheduled",
      };
  }
  if (status.cancelled) {
    return {
      statusHeading: "Postponed",
    };
  }
  if (status.finished || status.awarded) {
    return {
      statusHeading: "FT",
    };
  }
  if (!status.started) {
    return {
      statusHeading: "Scheduled",
    };
  }
  const liveShort = cleanLiveText(status?.liveTime?.short);
  if (liveShort === "HT") {
    return {
      statusHeading: `Live - ${halftimeLabel(status)}`,
    };
  }
  if (liveShort) {
    return {
      statusHeading: `Live - ${liveShort}`,
    };
  }
  const reasonShort = cleanLiveText(status?.reason?.short);
  if (reasonShort) {
    return {
      statusHeading: `Live - ${reasonShort}`,
    };
  }
  return {
    statusHeading: "Live",
  };
}

export async function GET() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const seasonStartYear = now.getUTCMonth() >= 6 ? year : year - 1;
  const season = `${seasonStartYear}/${seasonStartYear + 1}`;
  const url = `https://www.fotmob.com/api/leagues?id=${FOTMOB_LIGUE_1_ID}&tab=fixtures&season=${encodeURIComponent(season)}`;

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

    const data = await response.json();
    const matches = (data?.fixtures?.allMatches ?? []) as any[];
    const targetMatches = matches.filter(isTargetFixture);
    if (!targetMatches.length) {
      return NextResponse.json(
        { error: "Target fixture not found" },
        { status: 404 },
      );
    }

    const match =
      targetMatches.find((item) => item?.status?.started && !item?.status?.finished) ||
      targetMatches
        .slice()
        .sort(
          (a, b) =>
            new Date(String(b?.status?.utcTime || 0)).getTime() -
            new Date(String(a?.status?.utcTime || 0)).getTime(),
        )[0];

    const score = cleanLiveText(match?.status?.scoreStr)
      .replace(/\s*-\s*/g, " - ");
    const dateParts = formatPreviewDate(String(match?.status?.utcTime || match?.utcTime || now.toISOString()));
    const stateParts = liveStateParts(match?.status);

    return NextResponse.json(
      {
        competition: "Ligue 1",
        ...dateParts,
        ...stateParts,
        home: {
          name: String(match?.home?.name || "Paris Saint-Germain"),
          tla: String(match?.home?.shortName || "PSG"),
          shortName: String(match?.home?.shortName || "PSG"),
          badge: null,
        },
        away: {
          name: String(match?.away?.name || "Le Havre"),
          tla: String(match?.away?.shortName || "HAC"),
          shortName: String(match?.away?.shortName || "HAC"),
          badge: null,
        },
        score: score || "TBD",
        liveLabel: liveLabelFor(match?.status),
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
