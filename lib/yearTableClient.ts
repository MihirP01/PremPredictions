"use client";

import { canonicalRoomCode } from "./roomCode";
import { authenticatedFetch } from "./authenticatedFetch";
import { notifyRoomCache } from "./cacheStore";
import {
  peekSessionRecord,
  readFreshSessionRecord,
  writeSessionRecord,
} from "./sessionCache";
import type { YearTableClub } from "./yearTableScoring";

export type CachedYearPick = {
  uid: string;
  order: string[];
  submittedAt: string | null;
};

export type YearTableSnapshot = {
  ok?: boolean;
  open: boolean;
  scoringOpen: boolean;
  currentGw?: number;
  lockAfterGw?: number;
  teamKeys: string[];
  clubs: YearTableClub[];
  myPick: CachedYearPick | null;
  picks: CachedYearPick[];
};

const STORAGE_PREFIX = "yearTable:v1:";
const TTL_MS = 2 * 60 * 1000;
const memCache = new Map<
  string,
  { expiresAt: number; data: YearTableSnapshot }
>();
const pending = new Map<string, Promise<YearTableSnapshot>>();

function keyFor(roomCode: string, seasonKey: string, uid: string) {
  return `${canonicalRoomCode(roomCode)}::${seasonKey}::${uid}`;
}

function normalize(payload: unknown): YearTableSnapshot {
  const data = (payload || {}) as Partial<YearTableSnapshot>;
  return {
    ok: data.ok,
    open: data.open !== false,
    scoringOpen: data.scoringOpen === true,
    currentGw:
      data.currentGw == null ? undefined : Number(data.currentGw),
    lockAfterGw:
      data.lockAfterGw == null ? undefined : Number(data.lockAfterGw),
    teamKeys: Array.isArray(data.teamKeys) ? data.teamKeys.map(String) : [],
    clubs: Array.isArray(data.clubs) ? data.clubs : [],
    myPick: data.myPick ?? null,
    picks: Array.isArray(data.picks) ? data.picks : [],
  };
}

function peekEntry(key: string) {
  const memory = memCache.get(key);
  if (memory) return memory;
  const stored = peekSessionRecord<YearTableSnapshot>(STORAGE_PREFIX, key);
  if (!stored) return null;
  const entry = { expiresAt: stored.expiresAt, data: normalize(stored.data) };
  memCache.set(key, entry);
  return entry;
}

function setCached(key: string, data: YearTableSnapshot) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  notifyRoomCache();
}

export function peekYearTableCached(
  roomCode: string,
  seasonKey: string,
  uid: string,
) {
  if (!roomCode || !seasonKey || !uid) return null;
  return peekEntry(keyFor(roomCode, seasonKey, uid))?.data ?? null;
}

async function fetchSnapshot(
  roomCode: string,
  seasonKey: string,
  uid: string,
) {
  const key = keyFor(roomCode, seasonKey, uid);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const params = new URLSearchParams({
      roomCode: canonicalRoomCode(roomCode),
      seasonKey,
    });
    const response = await authenticatedFetch(
      `/api/game/year-table?${params.toString()}`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load year predictions.");
    }
    const data = normalize(payload);
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export async function getYearTableCached(
  roomCode: string,
  seasonKey: string,
  uid: string,
  opts?: { force?: boolean },
) {
  if (!roomCode || !seasonKey || !uid) {
    throw new Error("Year prediction identity is unavailable.");
  }
  const key = keyFor(roomCode, seasonKey, uid);
  const cached = peekEntry(key);
  if (!opts?.force) {
    const fresh = readFreshSessionRecord<YearTableSnapshot>(
      STORAGE_PREFIX,
      key,
    );
    if (fresh) {
      const data = normalize(fresh.data);
      memCache.set(key, { expiresAt: fresh.expiresAt, data });
      return data;
    }
  }
  return fetchSnapshot(roomCode, seasonKey, uid).catch((error) => {
    if (cached) return cached.data;
    throw error;
  });
}
