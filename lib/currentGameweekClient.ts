import { peekSessionRecord, writeSessionRecord } from "./sessionCache";

type CurrentGameweekResponse = {
  currentGameweek?: number;
  seasonKey?: string;
};

type CurrentGameweekData = {
  currentGameweek: number;
  seasonKey: string;
};

export type CurrentGameweekMode = "live" | "league";

const TTL_MS = 45 * 1000;
const STORAGE_PREFIX = "cgw:v4:";
const memCache = new Map<
  string,
  { expiresAt: number; data: CurrentGameweekData }
>();
const pending = new Map<string, Promise<CurrentGameweekData>>();

export function gameweekModeFromStyle(
  style?: string | null,
): CurrentGameweekMode {
  return style === "league" ? "league" : "live";
}

function keyFor(seasonKey?: string, mode: CurrentGameweekMode = "live") {
  return `${seasonKey ? `season:${seasonKey}` : "default"}:${mode}`;
}

function buildUrl(seasonKey?: string, mode: CurrentGameweekMode = "live") {
  const params = new URLSearchParams();
  if (seasonKey) params.set("seasonKey", seasonKey);
  if (mode === "league") params.set("mode", "league");
  const qs = params.toString();
  return qs ? `/api/current-gameweek?${qs}` : "/api/current-gameweek";
}

function normalize(data: CurrentGameweekResponse): CurrentGameweekData {
  const gw = Number(data?.currentGameweek ?? 1);
  return {
    currentGameweek: Number.isFinite(gw) ? gw : 1,
    seasonKey: String(data.seasonKey || ""),
  };
}

function peekCached(
  cacheKey: string,
): { expiresAt: number; data: CurrentGameweekData } | null {
  const mem = memCache.get(cacheKey);
  if (mem) return mem;
  const stored = peekSessionRecord<CurrentGameweekData>(STORAGE_PREFIX, cacheKey);
  if (!stored) return null;
  memCache.set(cacheKey, { expiresAt: stored.expiresAt, data: stored.data });
  return stored;
}

function setCached(cacheKey: string, data: CurrentGameweekData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, cacheKey, data, TTL_MS);
  memCache.set(cacheKey, { expiresAt, data });
}

export function primeCurrentGameweekCache(
  data: CurrentGameweekData,
  mode: CurrentGameweekMode = "live",
) {
  if (!data || !Number.isFinite(Number(data.currentGameweek))) return;
  const normalized: CurrentGameweekData = {
    currentGameweek: Number(data.currentGameweek),
    seasonKey: String(data.seasonKey || ""),
  };
  setCached(keyFor(undefined, mode), normalized);
  if (normalized.seasonKey) setCached(keyFor(normalized.seasonKey, mode), normalized);
}

function readCached(
  cacheKey: string,
  now: number,
  allowStale = false,
): CurrentGameweekData | null {
  const cached = peekCached(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt > now || allowStale) return cached.data;
  return null;
}

export async function getCurrentGameweekCached(
  seasonKey?: string,
  mode: CurrentGameweekMode = "live",
): Promise<CurrentGameweekData> {
  const cacheKey = keyFor(seasonKey, mode);
  const now = Date.now();
  const fresh = readCached(cacheKey, now);
  if (fresh) return fresh;
  const stale = readCached(cacheKey, now, true);
  if (stale) {
    void refreshCurrentGameweekCached(seasonKey, mode).catch(() => {});
    return stale;
  }

  if (seasonKey) {
    const defaultCached = readCached(keyFor(undefined, mode), now, true);
    if (defaultCached && defaultCached.seasonKey === seasonKey) {
      setCached(cacheKey, defaultCached);
      return defaultCached;
    }
  }

  const existing = pending.get(cacheKey);
  if (existing) return existing;

  const req = (async () => {
    const res = await fetch(buildUrl(seasonKey, mode), { cache: "no-store" });
    const data = normalize((await res.json()) as CurrentGameweekResponse);
    setCached(cacheKey, data);
    if (data.seasonKey) setCached(keyFor(data.seasonKey, mode), data);
    if (cacheKey !== keyFor(undefined, mode)) {
      setCached(keyFor(undefined, mode), data);
    }
    return data;
  })().finally(() => {
    pending.delete(cacheKey);
  });

  pending.set(cacheKey, req);
  return req;
}

export async function refreshCurrentGameweekCached(
  seasonKey?: string,
  mode: CurrentGameweekMode = "live",
): Promise<CurrentGameweekData> {
  const cacheKey = keyFor(seasonKey, mode);
  const res = await fetch(buildUrl(seasonKey, mode), { cache: "no-store" });
  const data = normalize((await res.json()) as CurrentGameweekResponse);
  setCached(cacheKey, data);
  if (data.seasonKey) setCached(keyFor(data.seasonKey, mode), data);
  if (cacheKey !== keyFor(undefined, mode)) {
    setCached(keyFor(undefined, mode), data);
  }
  return data;
}
