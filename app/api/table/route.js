import { NextResponse } from "next/server";
import { getSeasonClubCatalog } from "@/lib/server/season-clubs";
import {
  PROVIDER_SNAPSHOT_KIND,
  getLatestProviderSnapshot,
  getProviderSnapshotAt,
  isSnapshotFresh,
  parseSnapshotAt,
  saveProviderSnapshot,
} from "@/lib/server/provider-snapshots";

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
  const { searchParams } = new URL(req.url);
  const requestedSeason = searchParams.get("seasonKey");
  const seasonKey = normalizeSeasonKey(requestedSeason) || inferSeasonKey();
  const snapshotAt = parseSnapshotAt(searchParams.get("at"));
  const forceRefresh =
    searchParams.get("refresh") === "1" || searchParams.has("t");
  const season = seasonStartYearFromKey(seasonKey);
  const snapshotKey = {
    kind: PROVIDER_SNAPSHOT_KIND.standings,
    seasonKey,
  };

  if (snapshotAt) {
    const stored = await getProviderSnapshotAt(snapshotKey, snapshotAt).catch(
      () => null,
    );
    return stored?.payload
      ? NextResponse.json(
          { ...stored.payload, capturedAt: stored.capturedAt.toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.json(
          { error: "No standings snapshot at that time" },
          { status: 404 },
        );
  }

  if (!forceRefresh) {
    const latest = await getLatestProviderSnapshot(snapshotKey).catch(
      () => null,
    );
    if (latest && isSnapshotFresh(latest.capturedAt, 45_000) && latest.payload) {
      return NextResponse.json(
        { ...latest.payload, capturedAt: latest.capturedAt.toISOString() },
        {
          headers: {
            "Cache-Control": "s-maxage=45, stale-while-revalidate=15",
          },
        },
      );
    }
  }

  const API_KEY = process.env.FOOTBALLDATA_KEY;
  if (!API_KEY) {
    const stored = await getLatestProviderSnapshot(snapshotKey).catch(
      () => null,
    );
    return stored?.payload
      ? NextResponse.json(
          { ...stored.payload, capturedAt: stored.capturedAt.toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.json(
          { error: "API key not configured" },
          { status: 500 },
        );
  }

  const url = `https://api.football-data.org/v4/competitions/${LEAGUE}/standings?season=${season}`;

  let response;
  let seasonClubs = [];
  try {
    [response, seasonClubs] = await Promise.all([
      fetch(url, {
        headers: { "X-Auth-Token": API_KEY },
        next: { revalidate: 45 },
      }),
      getSeasonClubCatalog(seasonKey, API_KEY).catch(() => []),
    ]);
  } catch {
    const stored = await getLatestProviderSnapshot(snapshotKey).catch(
      () => null,
    );
    return stored?.payload
      ? NextResponse.json(
          { ...stored.payload, capturedAt: stored.capturedAt.toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.json(
          { error: "Upstream fetch failed" },
          { status: 502 },
        );
  }

  const clubByTeamId = new Map(
    seasonClubs.map((club) => [Number(club.teamId), club]),
  );

  const mapRows = (rows = []) =>
    rows.map((row) => {
      const teamId = Number(row?.team?.id);
      const stored = clubByTeamId.get(teamId);
      return {
        position: Number(row.position ?? 0),
        team: {
          id: Number.isFinite(teamId) ? teamId : null,
          name: stored?.name || row?.team?.name || "Club",
          tla: stored?.tla || row?.team?.tla || null,
          shortName:
            stored?.shortName ||
            row?.team?.shortName ||
            row?.team?.tla ||
            row?.team?.name ||
            "Club",
          badge: stored?.badgeUrl || row?.team?.crest || null,
        },
        playedGames: Number(row.playedGames ?? 0),
        won: Number(row.won ?? 0),
        draw: Number(row.draw ?? 0),
        lost: Number(row.lost ?? 0),
        goalsScored: Number(row.goalsFor ?? 0),
        goalsAgainst: Number(row.goalsAgainst ?? 0),
        goalDifference: Number(row.goalDifference ?? 0),
        points: Number(row.points ?? 0),
      };
    });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("Football-Data standings error:", response.status, body);
    const stored = await getLatestProviderSnapshot(snapshotKey).catch(
      () => null,
    );
    return stored?.payload
      ? NextResponse.json(
          { ...stored.payload, capturedAt: stored.capturedAt.toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.json(
          { error: "Football API error", status: response.status },
          { status: 502 },
        );
  }

  const data = await response.json();
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

  const payload = { seasonKey, standingsTotal, standingsHome, standingsAway };
  const snapshot = await saveProviderSnapshot(
    snapshotKey,
    payload,
    "football-data",
  ).catch(() => null);

  return NextResponse.json(
    {
      ...payload,
      capturedAt: snapshot?.capturedAt?.toISOString() || new Date().toISOString(),
    },
    { headers: { "Cache-Control": "s-maxage=45, stale-while-revalidate=15" } },
  );
}
