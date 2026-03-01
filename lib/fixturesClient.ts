export type FixtureItem = {
  fixtureId: number;
  gameweek: number;
  kickoff: string;
  status: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  result?: string | null;
};

export type FixturesCachedData = {
  fixtures: FixtureItem[];
  generatedAt: string | null;
};

const TTL_MS = 60 * 1000;
const STORAGE_PREFIX = "fx:v1:";
const memCache = new Map<string, { expiresAt: number; data: FixturesCachedData }>();
const pending = new Map<string, Promise<FixturesCachedData>>();

function keyFor(gameweek: number, seasonKey: string) {
  return `${seasonKey}:gw:${gameweek}`;
}

function normalize(data: unknown): FixturesCachedData {
  const payload = (data || {}) as { fixtures?: FixtureItem[]; generatedAt?: string };
  return {
    fixtures: Array.isArray(payload.fixtures) ? payload.fixtures : [],
    generatedAt: payload.generatedAt ? String(payload.generatedAt) : null,
  };
}

function getStorage(key: string): FixturesCachedData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; data?: FixturesCachedData };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function getStorageStale(key: string): FixturesCachedData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: FixturesCachedData };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function setStorage(key: string, data: FixturesCachedData) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({ expiresAt: Date.now() + TTL_MS, data }),
    );
  } catch {
    // ignore storage write failures
  }
}

function mergeFixtureResults(
  previous: FixturesCachedData | null,
  next: FixturesCachedData,
): FixturesCachedData {
  if (!previous?.fixtures?.length || !next.fixtures.length) return next;
  const prevById = new Map(previous.fixtures.map((fixture) => [fixture.fixtureId, fixture]));
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
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data: merged });
  setStorage(key, merged);
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
    memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
    return stored;
  }
  const staleStorage = getStorageStale(key);
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
