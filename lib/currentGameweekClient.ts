import { readFreshSessionRecord, writeSessionRecord } from "./sessionCache";

type CurrentGameweekResponse = {
  currentGameweek?: number;
  seasonKey?: string;
};

type CurrentGameweekData = {
  currentGameweek: number;
  seasonKey: string;
};

const TTL_MS = 20 * 1000;
const STORAGE_PREFIX = "cgw:v3:";
const memCache = new Map<
  string,
  { expiresAt: number; data: CurrentGameweekData }
>();
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

function getStorage(key: string): { expiresAt: number; data: CurrentGameweekData } | null {
  return readFreshSessionRecord<CurrentGameweekData>(STORAGE_PREFIX, key);
}

function setCached(cacheKey: string, data: CurrentGameweekData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, cacheKey, data, TTL_MS);
  memCache.set(cacheKey, { expiresAt, data });
}

export function primeCurrentGameweekCache(data: CurrentGameweekData) {
  if (!data || !Number.isFinite(Number(data.currentGameweek))) return;
  const normalized: CurrentGameweekData = {
    currentGameweek: Number(data.currentGameweek),
    seasonKey: String(data.seasonKey || ""),
  };
  setCached("default", normalized);
  if (normalized.seasonKey) setCached(keyFor(normalized.seasonKey), normalized);
}

function readCached(cacheKey: string, now: number): CurrentGameweekData | null {
  const mem = memCache.get(cacheKey);
  if (mem && mem.expiresAt > now) return mem.data;

  const stored = getStorage(cacheKey);
  if (stored) {
    memCache.set(cacheKey, stored);
    return stored.data;
  }

  return null;
}

export async function getCurrentGameweekCached(
  seasonKey?: string,
): Promise<CurrentGameweekData> {
  const cacheKey = keyFor(seasonKey);
  const now = Date.now();
  const cached = readCached(cacheKey, now);
  if (cached) return cached;

  // If a season-specific caller asks for the same season as default cache,
  // reuse it and avoid a second network roundtrip.
  if (seasonKey) {
    const defaultCached = readCached("default", now);
    if (defaultCached && defaultCached.seasonKey === seasonKey) {
      setCached(cacheKey, defaultCached);
      return defaultCached;
    }
  }

  const existing = pending.get(cacheKey);
  if (existing) return existing;

  const url = seasonKey
    ? `/api/current-gameweek?seasonKey=${encodeURIComponent(seasonKey)}`
    : "/api/current-gameweek";

  const req = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    const data = normalize((await res.json()) as CurrentGameweekResponse);
    setCached(cacheKey, data);
    if (data.seasonKey) setCached(keyFor(data.seasonKey), data);
    if (cacheKey !== "default") setCached("default", data);
    return data;
  })().finally(() => {
    pending.delete(cacheKey);
  });

  pending.set(cacheKey, req);
  return req;
}

export async function refreshCurrentGameweekCached(
  seasonKey?: string,
): Promise<CurrentGameweekData> {
  const cacheKey = keyFor(seasonKey);
  const url = seasonKey
    ? `/api/current-gameweek?seasonKey=${encodeURIComponent(seasonKey)}`
    : "/api/current-gameweek";
  const res = await fetch(url, { cache: "no-store" });
  const data = normalize((await res.json()) as CurrentGameweekResponse);
  setCached(cacheKey, data);
  if (data.seasonKey) setCached(keyFor(data.seasonKey), data);
  if (cacheKey !== "default") setCached("default", data);
  return data;
}
