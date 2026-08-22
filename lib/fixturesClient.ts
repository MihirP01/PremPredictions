import { notifyRoomCache } from "./cacheStore";
import {
  readFreshSessionRecord,
  readSessionRecord,
  writeSessionRecord,
} from "./sessionCache";

export type FixtureItem = {
  fixtureId: number;
  gameweek: number;
  kickoff: string;
  status: string;
  home: {
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  away: {
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  result?: string | null;
};

export type FixturesCachedData = {
  fixtures: FixtureItem[];
  generatedAt: string | null;
};

const TTL_MS = 45 * 1000;
const STORAGE_PREFIX = "fx:v2:";
const memCache = new Map<
  string,
  { expiresAt: number; data: FixturesCachedData }
>();
const pending = new Map<string, Promise<FixturesCachedData>>();

function keyFor(gameweek: number, seasonKey: string) {
  return `${seasonKey}:gw:${gameweek}`;
}

function normalize(data: unknown): FixturesCachedData {
  const payload = (data || {}) as {
    fixtures?: FixtureItem[];
    generatedAt?: string;
  };
  return {
    fixtures: Array.isArray(payload.fixtures) ? payload.fixtures : [],
    generatedAt: payload.generatedAt ? String(payload.generatedAt) : null,
  };
}

function getStorage(key: string): { expiresAt: number; data: FixturesCachedData } | null {
  return readFreshSessionRecord<FixturesCachedData>(STORAGE_PREFIX, key);
}

function getStorageStale(key: string): FixturesCachedData | null {
  return readSessionRecord<FixturesCachedData>(STORAGE_PREFIX, key)?.data ?? null;
}

function mergeFixtureResults(
  previous: FixturesCachedData | null,
  next: FixturesCachedData,
): FixturesCachedData {
  if (!previous?.fixtures?.length || !next.fixtures.length) return next;
  const prevById = new Map(
    previous.fixtures.map((fixture) => [fixture.fixtureId, fixture]),
  );
  return {
    ...next,
    fixtures: next.fixtures.map((fixture) => {
      if (fixture.result != null) return fixture;
      const prev = prevById.get(fixture.fixtureId);
      if (!prev?.result) return fixture;
      return {
        ...fixture,
        result: prev.result,
      };
    }),
  };
}

function setCached(key: string, data: FixturesCachedData) {
  const previous = memCache.get(key)?.data ?? getStorageStale(key);
  const merged = mergeFixtureResults(previous, data);
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, merged, TTL_MS);
  memCache.set(key, { expiresAt, data: merged });
  notifyRoomCache();
}

export function peekFixturesCached(
  gameweek: number,
  seasonKey: string,
): FixturesCachedData | null {
  const gw = Number(gameweek);
  const sk = String(seasonKey || "");
  if (!Number.isFinite(gw) || !sk) return null;
  const key = keyFor(gw, sk);
  const mem = memCache.get(key);
  if (mem) return mem.data;
  const stored = readSessionRecord<FixturesCachedData>(STORAGE_PREFIX, key);
  if (!stored) return null;
  memCache.set(key, { expiresAt: stored.expiresAt, data: stored.data });
  return stored.data;
}

export async function getFixturesCached(
  gameweek: number,
  seasonKey: string,
): Promise<FixturesCachedData> {
  const gw = Number(gameweek);
  const sk = String(seasonKey || "");
  if (!Number.isFinite(gw) || !sk) return { fixtures: [], generatedAt: null };
  const key = keyFor(gw, sk);
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const staleMem = mem?.data ?? null;
  const stored = getStorage(key);
  if (stored) {
    memCache.set(key, stored);
    return stored.data;
  }
  const staleStorage = getStorageStale(key);
  const stale = staleMem || staleStorage;
  if (stale) {
    const existing = pending.get(key);
    if (!existing) {
      const req = (async () => {
        const res = await fetch(
          `/api/fixtures?gameweek=${encodeURIComponent(String(gw))}&seasonKey=${encodeURIComponent(sk)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (stale) return stale;
          throw new Error(`fixtures ${res.status}`);
        }
        const data = normalize(await res.json());
        setCached(key, data);
        return data;
      })().finally(() => pending.delete(key));
      pending.set(key, req);
    }
    return stale;
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const res = await fetch(
      `/api/fixtures?gameweek=${encodeURIComponent(String(gw))}&seasonKey=${encodeURIComponent(sk)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const stale = staleMem || staleStorage;
      if (stale) return stale;
      throw new Error(`fixtures ${res.status}`);
    }
    const data = normalize(await res.json());
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export async function refreshFixturesCached(
  gameweek: number,
  seasonKey: string,
): Promise<FixturesCachedData> {
  const gw = Number(gameweek);
  const sk = String(seasonKey || "");
  if (!Number.isFinite(gw) || !sk) return { fixtures: [], generatedAt: null };
  const key = keyFor(gw, sk);
  const res = await fetch(
    `/api/fixtures?gameweek=${encodeURIComponent(String(gw))}&seasonKey=${encodeURIComponent(sk)}&refresh=1&t=${Date.now()}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`fixtures ${res.status}`);
  const data = normalize(await res.json());
  setCached(key, data);
  return data;
}
