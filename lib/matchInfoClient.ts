export type MatchInfoMiniTeam = {
  id: number | null;
  name: string;
  tla?: string | null;
};

export type MatchInfoMiniMatch = {
  id: number | null;
  utcDate: string;
  homeTeam: MatchInfoMiniTeam;
  awayTeam: MatchInfoMiniTeam;
  competition?: {
    name: string;
    emblem?: string | null;
    code?: string | null;
  };
  result: string;
  status: string;
  form?: "W" | "D" | "L" | "—";
};

export type MatchInfoData = {
  fixtureId: number;
  generatedAt: string;
  headToHead: MatchInfoMiniMatch[];
  form: {
    home: MatchInfoMiniMatch[];
    away: MatchInfoMiniMatch[];
  };
};

const TTL_MS = 10 * 60 * 1000;
const STORAGE_PREFIX = "match-info:v4:";
const memCache = new Map<string, { expiresAt: number; data: MatchInfoData }>();
const pending = new Map<string, Promise<MatchInfoData>>();

function keyFor(fixtureId: number, seasonKey: string) {
  return `${String(seasonKey || "")}:fx:${String(fixtureId)}`;
}

function normalize(payload: unknown): MatchInfoData {
  const p = (payload || {}) as Partial<MatchInfoData>;
  return {
    fixtureId: Number(p.fixtureId ?? 0),
    generatedAt: String(p.generatedAt || ""),
    headToHead: Array.isArray(p.headToHead) ? p.headToHead : [],
    form: {
      home: Array.isArray(p.form?.home) ? p.form!.home : [],
      away: Array.isArray(p.form?.away) ? p.form!.away : [],
    },
  };
}

function getStorage(key: string): MatchInfoData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      data?: MatchInfoData;
    };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return normalize(parsed.data);
  } catch {
    return null;
  }
}

function setStorage(key: string, data: MatchInfoData) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({ expiresAt: Date.now() + TTL_MS, data }),
    );
  } catch {
    // ignore storage failures
  }
}

function setCached(key: string, data: MatchInfoData) {
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  setStorage(key, data);
}

export async function getMatchInfoCached(
  fixtureId: number,
  seasonKey: string,
  homeTeamId?: number | null,
  awayTeamId?: number | null,
): Promise<MatchInfoData> {
  const id = Number(fixtureId);
  const sk = String(seasonKey || "");
  if (!Number.isFinite(id) || !sk) {
    throw new Error("Invalid fixture/season.");
  }

  const key = keyFor(id, sk);
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const stored = getStorage(key);
  if (stored) {
    memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
    return stored;
  }

  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const params = new URLSearchParams({
      fixtureId: String(id),
      seasonKey: sk,
    });
    if (Number.isFinite(Number(homeTeamId))) params.set("homeTeamId", String(homeTeamId));
    if (Number.isFinite(Number(awayTeamId))) params.set("awayTeamId", String(awayTeamId));
    const res = await fetch(
      `/api/match-info?${params.toString()}`,
      { cache: "no-store" },
    );
    const body = (await res.json().catch(() => ({}))) as MatchInfoData & { error?: string };
    if (!res.ok) throw new Error(body?.error || `match-info ${res.status}`);
    const normalized = normalize(body);
    setCached(key, normalized);
    return normalized;
  })().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}
