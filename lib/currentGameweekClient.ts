type CurrentGameweekResponse = {
  currentGameweek?: number;
  seasonKey?: string;
};

type CurrentGameweekData = {
  currentGameweek: number;
  seasonKey: string;
};

const TTL_MS = 5 * 60 * 1000;
const STORAGE_PREFIX = "cgw:v1:";
const memCache = new Map<string, { expiresAt: number; data: CurrentGameweekData }>();
const pending = new Map<string, Promise<CurrentGameweekData>>();

function keyFor(seasonKey?: string) {
  return seasonKey ? `season:${seasonKey}` : "default";
}

function normalize(data: CurrentGameweekResponse): CurrentGameweekData {
  const gw = Number(data?.currentGameweek ?? 1);
  return {
    currentGameweek: Number.isFinite(gw) ? gw : 1,
    seasonKey: String(data?.seasonKey || ""),
  };
}

function getStorage(key: string): CurrentGameweekData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      data?: CurrentGameweekData;
    };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function setStorage(key: string, data: CurrentGameweekData) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({
        expiresAt: Date.now() + TTL_MS,
        data,
      }),
    );
  } catch {
    // ignore storage write failures
  }
}

export async function getCurrentGameweekCached(
  seasonKey?: string,
): Promise<CurrentGameweekData> {
  const cacheKey = keyFor(seasonKey);
  const now = Date.now();

  const mem = memCache.get(cacheKey);
  if (mem && mem.expiresAt > now) return mem.data;

  const stored = getStorage(cacheKey);
  if (stored) {
    memCache.set(cacheKey, { expiresAt: now + TTL_MS, data: stored });
    return stored;
  }

  const existing = pending.get(cacheKey);
  if (existing) return existing;

  const url = seasonKey
    ? `/api/current-gameweek?seasonKey=${encodeURIComponent(seasonKey)}`
    : "/api/current-gameweek";

  const req = (async () => {
    const res = await fetch(url);
    const data = normalize((await res.json()) as CurrentGameweekResponse);
    memCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, data });
    setStorage(cacheKey, data);
    return data;
  })().finally(() => {
    pending.delete(cacheKey);
  });

  pending.set(cacheKey, req);
  return req;
}

