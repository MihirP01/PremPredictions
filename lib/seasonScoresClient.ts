"use client";

import { authenticatedFetch } from "./authenticatedFetch";
import { notifyRoomCache } from "./cacheStore";
import {
  peekSessionRecord,
  readFreshSessionRecord,
  writeSessionRecord,
} from "./sessionCache";

export type ScoreBreakdownItem = {
  base?: number;
  golden?: boolean;
  pred?: string | null;
  actual?: string | null;
  total?: number;
};

export type SeasonScoreUserDoc = {
  uid: string;
  points: number;
  breakdown: Record<string, ScoreBreakdownItem>;
  scoreStatus?: "scored" | "missed" | "fair_play_bye";
  fairPlayApplied?: boolean;
  fairPlayMedian?: number | null;
};

export type SeasonScoreWeek = {
  gw: number;
  computedAtMs: number | null;
  users: SeasonScoreUserDoc[];
};

export type SeasonScoresSnapshot = {
  roomCode: string;
  seasonKey: string;
  fetchedAtMs: number;
  weeks: SeasonScoreWeek[];
  gameWeeks: number[];
};

const STORAGE_PREFIX = "seasonScores:v3:";
const TTL_MS = 15_000;

const memCache = new Map<
  string,
  { expiresAt: number; data: SeasonScoresSnapshot }
>();
const pending = new Map<string, Promise<SeasonScoresSnapshot>>();

function keyFor(roomCode: string, seasonKey: string) {
  return `${String(roomCode || "").toUpperCase()}::${String(seasonKey || "")}`;
}

function getStorage(
  key: string,
): { expiresAt: number; data: SeasonScoresSnapshot } | null {
  return readFreshSessionRecord<SeasonScoresSnapshot>(STORAGE_PREFIX, key);
}

function setStorage(key: string, data: SeasonScoresSnapshot) {
  writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
}

async function fetchSnapshot(
  roomCode: string,
  seasonKey: string,
): Promise<SeasonScoresSnapshot> {
  const upperRoom = String(roomCode || "").toUpperCase();
  const season = String(seasonKey || "");
  const params = new URLSearchParams({
    roomCode: upperRoom,
    seasonKey: season,
  });
  const response = await authenticatedFetch(
    `/api/game/season-scores?${params}`,
    { cache: "no-store" },
  );
  const payload = (await response
    .json()
    .catch(() => ({}))) as Partial<SeasonScoresSnapshot> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `scores ${response.status}`);
  }
  return {
    roomCode: upperRoom,
    seasonKey: season,
    fetchedAtMs: Number(payload.fetchedAtMs || Date.now()),
    weeks: Array.isArray(payload.weeks) ? payload.weeks : [],
    gameWeeks: Array.isArray(payload.gameWeeks) ? payload.gameWeeks : [],
  };
}

export function peekSeasonScoresSnapshotCached(
  roomCode: string,
  seasonKey: string,
): SeasonScoresSnapshot | null {
  const key = keyFor(roomCode, seasonKey);
  const mem = memCache.get(key);
  if (mem) return mem.data;
  const stored = peekSessionRecord<SeasonScoresSnapshot>(STORAGE_PREFIX, key);
  if (!stored) return null;
  memCache.set(key, { expiresAt: stored.expiresAt, data: stored.data });
  return stored.data;
}

export async function getSeasonScoresSnapshotCached(
  roomCode: string,
  seasonKey: string,
  opts?: { force?: boolean },
): Promise<SeasonScoresSnapshot> {
  const key = keyFor(roomCode, seasonKey);
  if (!opts?.force) {
    const mem = memCache.get(key);
    if (mem && mem.expiresAt > Date.now()) return mem.data;
    const stored = getStorage(key);
    if (stored) {
      memCache.set(key, stored);
      return stored.data;
    }
  }

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const req = (async () => {
    try {
      const data = await fetchSnapshot(roomCode, seasonKey);
      memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
      setStorage(key, data);
      notifyRoomCache();
      return data;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, req);
  return req;
}

export function prewarmSeasonScoresSnapshot(
  roomCode: string,
  seasonKey: string,
) {
  void getSeasonScoresSnapshotCached(roomCode, seasonKey).catch(() => {});
}
