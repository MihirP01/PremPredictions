import { notifyRoomCache } from "./cacheStore";
import { peekSessionRecord, writeSessionRecord } from "./sessionCache";

export type TableRow = {
  position: number;
  team: {
    id?: number | null;
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsScored: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type TableData = {
  standingsTotal: TableRow[];
  standingsHome: TableRow[];
  standingsAway: TableRow[];
};

const TTL_MS = 2 * 60 * 1000;
const STORAGE_PREFIX = "tbl:v3:";
const memCache = new Map<string, { expiresAt: number; data: TableData }>();
const pending = new Map<string, Promise<TableData>>();

function keyFor(seasonKey: string) {
  return String(seasonKey || "");
}

function normalize(payload: unknown): TableData {
  const data = (payload || {}) as {
    standingsTotal?: TableRow[];
    standingsHome?: TableRow[];
    standingsAway?: TableRow[];
  };
  return {
    standingsTotal: Array.isArray(data.standingsTotal)
      ? data.standingsTotal
      : [],
    standingsHome: Array.isArray(data.standingsHome) ? data.standingsHome : [],
    standingsAway: Array.isArray(data.standingsAway) ? data.standingsAway : [],
  };
}

function peekCached(
  key: string,
): { expiresAt: number; data: TableData } | null {
  const mem = memCache.get(key);
  if (mem) return mem;
  const stored = peekSessionRecord<TableData>(STORAGE_PREFIX, key);
  if (!stored) return null;
  const entry = { expiresAt: stored.expiresAt, data: stored.data };
  memCache.set(key, entry);
  return entry;
}

function setCached(key: string, data: TableData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  notifyRoomCache();
}

export function peekTableCached(seasonKey: string): TableData | null {
  return peekCached(keyFor(seasonKey))?.data ?? null;
}

function fetchTable(key: string): Promise<TableData> {
  const existing = pending.get(key);
  if (existing) return existing;
  const req = (async () => {
    const seasonParam = key ? `?seasonKey=${encodeURIComponent(key)}` : "";
    const res = await fetch(`/api/table${seasonParam}`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error =
        (payload as { error?: string })?.error || `table ${res.status}`;
      throw new Error(error);
    }
    const data = normalize(payload);
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export async function getTableCached(seasonKey: string): Promise<TableData> {
  const key = keyFor(seasonKey);
  const cached = peekCached(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) {
    void fetchTable(key).catch(() => {});
    return cached.data;
  }
  return fetchTable(key);
}
