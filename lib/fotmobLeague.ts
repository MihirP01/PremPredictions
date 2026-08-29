import {
  PROVIDER_SNAPSHOT_KIND,
  getLatestProviderSnapshot,
  isSnapshotFresh,
  saveProviderSnapshot,
} from "@/lib/server/provider-snapshots";

const FOTMOB_LEAGUE_ID = 47;
const LIVE_TTL_MS = 15_000;
const UPCOMING_TTL_MS = 45_000;
const IDLE_TTL_MS = 3 * 60_000;
const UPCOMING_WINDOW_MS = 30 * 60_000;
const RECENTLY_KICKED_OFF_MS = 4 * 60 * 60 * 1000;

export type FotmobLeagueMatch = {
  id?: number;
  pageUrl?: string;
  round?: number | string;
  roundName?: number | string;
  home?: { id?: number; name?: string; shortName?: string };
  away?: { id?: number; name?: string; shortName?: string };
  status?: {
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
};

type CacheEntry = {
  matches: FotmobLeagueMatch[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<FotmobLeagueMatch[]>>();

function isLiveStatus(status: FotmobLeagueMatch["status"]) {
  return Boolean(
    status?.started &&
      !status?.finished &&
      !status?.awarded &&
      !status?.cancelled,
  );
}

function isSettledStatus(status: FotmobLeagueMatch["status"]) {
  return Boolean(status?.finished || status?.awarded || status?.cancelled);
}

function ttlForMatches(matches: FotmobLeagueMatch[]) {
  if (!matches.length) return LIVE_TTL_MS;
  const now = Date.now();
  let upcoming = false;
  for (const match of matches) {
    if (isLiveStatus(match.status)) return LIVE_TTL_MS;
    const kickoffMs = Date.parse(String(match.status?.utcTime || ""));
    if (!Number.isFinite(kickoffMs)) continue;
    if (
      kickoffMs <= now &&
      now - kickoffMs <= RECENTLY_KICKED_OFF_MS &&
      !isSettledStatus(match.status)
    ) {
      return LIVE_TTL_MS;
    }
    if (kickoffMs > now && kickoffMs - now <= UPCOMING_WINDOW_MS) {
      upcoming = true;
    }
  }
  return upcoming ? UPCOMING_TTL_MS : IDLE_TTL_MS;
}

const FOTMOB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
};

function matchesFromPayload(data: unknown): FotmobLeagueMatch[] | null {
  const root = (data || {}) as {
    props?: { pageProps?: { fixtures?: { allMatches?: FotmobLeagueMatch[] } } };
    fixtures?: { allMatches?: FotmobLeagueMatch[] };
  };
  const fromPage = root.props?.pageProps?.fixtures?.allMatches;
  const fromJson = root.fixtures?.allMatches;
  const matches = Array.isArray(fromPage)
    ? fromPage
    : Array.isArray(fromJson)
      ? fromJson
      : null;
  return matches;
}

function parseNextData(html: string) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("FotMob page payload not found.");
  return JSON.parse(match[1]);
}

function jsonUrlsForSeason(season: string) {
  const encoded = encodeURIComponent(season);
  return [
    `https://www.fotmob.com/api/data/leagues?id=${FOTMOB_LEAGUE_ID}&season=${encoded}`,
    `https://www.fotmob.com/api/leagues?id=${FOTMOB_LEAGUE_ID}&tab=fixtures&season=${encoded}`,
  ];
}

async function parseJsonResponse(response: Response) {
  const contentType = String(response.headers.get("content-type") || "");
  const body = await response.text();
  if (!body.trim()) return null;
  if (
    !contentType.includes("json") &&
    body.trimStart().startsWith("<")
  ) {
    return null;
  }
  try {
    return matchesFromPayload(JSON.parse(body));
  } catch {
    return null;
  }
}

async function fetchLeagueMatchesJson(season: string) {
  for (const url of jsonUrlsForSeason(season)) {
    const response = await fetch(url, {
      headers: FOTMOB_HEADERS,
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) continue;
    const matches = await parseJsonResponse(response);
    if (matches?.length) return matches;
  }
  return null;
}

async function fetchLeagueMatchesHtml(season: string) {
  const url = `https://www.fotmob.com/leagues/${FOTMOB_LEAGUE_ID}/matches/premier-league?season=${encodeURIComponent(season)}`;
  const response = await fetch(url, {
    headers: FOTMOB_HEADERS,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`FotMob league fetch failed (${response.status})`);
  }
  const html = await response.text();
  const matches = matchesFromPayload(parseNextData(html));
  if (!matches) throw new Error("FotMob league fixtures not found.");
  return matches;
}

async function fetchLeagueMatches(season: string) {
  const fromJson = await fetchLeagueMatchesJson(season).catch(() => null);
  if (fromJson?.length) return fromJson;
  return fetchLeagueMatchesHtml(season);
}

export function fotmobSeasonFromSeasonKey(seasonKey: string) {
  const startYear = 2000 + Number(String(seasonKey).slice(0, 2));
  return `${startYear}/${startYear + 1}`;
}

export function seasonKeyFromFotmobSeason(season: string) {
  const match = /^(\d{4})\s*[/-]\s*(\d{2,4})$/.exec(String(season || "").trim());
  if (match) {
    const startYY = String(Number(match[1]) % 100).padStart(2, "0");
    const endYY = String(Number(match[2]) % 100).padStart(2, "0");
    return `${startYY}${endYY}`;
  }
  const digits = String(season || "").replace(/\D/g, "");
  return /^\d{4}$/.test(digits) ? digits : "";
}

export { ttlForMatches };

async function matchesFromSnapshot(
  season: string,
  opts?: { allowStale?: boolean },
) {
  const seasonKey = seasonKeyFromFotmobSeason(season);
  const snapshot = await getLatestProviderSnapshot<{
    matches?: FotmobLeagueMatch[];
  }>({
    kind: PROVIDER_SNAPSHOT_KIND.fotmobLeague,
    seasonKey,
  }).catch(() => null);
  const matches = Array.isArray(snapshot?.payload?.matches)
    ? snapshot.payload.matches
    : [];
  if (!matches.length || !snapshot) return null;
  const ttl = opts?.allowStale
    ? Number.MAX_SAFE_INTEGER
    : ttlForMatches(matches);
  if (!isSnapshotFresh(snapshot.capturedAt, ttl)) return null;
  return matches;
}

async function persistLeagueMatches(season: string, matches: FotmobLeagueMatch[]) {
  if (!matches.length) return;
  const seasonKey = seasonKeyFromFotmobSeason(season);
  await saveProviderSnapshot(
    {
      kind: PROVIDER_SNAPSHOT_KIND.fotmobLeague,
      seasonKey,
    },
    { season, matches },
    "fotmob",
  ).catch(() => null);
}

export async function getFotmobLeagueMatches(
  season: string,
  opts?: { force?: boolean },
): Promise<FotmobLeagueMatch[]> {
  const key = String(season || "").trim();
  if (!key) return [];

  const now = Date.now();
  if (!opts?.force) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.matches;
  }

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const req = (async () => {
    try {
      if (!opts?.force) {
        const stored = await matchesFromSnapshot(key).catch(() => null);
        if (stored?.length) {
          cache.set(key, {
            matches: stored,
            expiresAt: Date.now() + ttlForMatches(stored),
          });
          return stored;
        }
      }
      const matches = await fetchLeagueMatches(key);
      cache.set(key, {
        matches,
        expiresAt: Date.now() + ttlForMatches(matches),
      });
      void persistLeagueMatches(key, matches);
      return matches;
    } catch (error) {
      const staleMem = cache.get(key);
      if (staleMem) return staleMem.matches;
      const staleSql = await matchesFromSnapshot(key, { allowStale: true }).catch(
        () => null,
      );
      if (staleSql?.length) return staleSql;
      throw error;
    }
  })().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}
