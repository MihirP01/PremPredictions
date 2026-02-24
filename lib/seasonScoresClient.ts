"use client";

import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

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

const STORAGE_PREFIX = "seasonScores:v1:";
const TTL_MS = 45_000;

const memCache = new Map<string, { expiresAt: number; data: SeasonScoresSnapshot }>();
const pending = new Map<string, Promise<SeasonScoresSnapshot>>();

function parseGwId(id: string): number | null {
  const m = /^gw-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function asDateMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      const d = maybeTimestamp.toDate();
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

function keyFor(roomCode: string, seasonKey: string) {
  return `${String(roomCode || "").toUpperCase()}::${String(seasonKey || "")}`;
}

function getStorage(key: string): SeasonScoresSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt: number;
      data: SeasonScoresSnapshot;
    };
    if (!parsed?.expiresAt || !parsed?.data) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function setStorage(key: string, data: SeasonScoresSnapshot) {
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

async function fetchSnapshot(roomCode: string, seasonKey: string): Promise<SeasonScoresSnapshot> {
  const upperRoom = String(roomCode || "").toUpperCase();
  const season = String(seasonKey || "");

  const scoreWeeksSnap = await getDocs(
    collection(db, "rooms", upperRoom, "seasons", season, "scores"),
  );

  const weeksBase = scoreWeeksSnap.docs
    .map((docSnap) => {
      const gw = parseGwId(docSnap.id);
      if (gw == null) return null;
      const data = docSnap.data() as { computedAt?: unknown };
      return {
        gw,
        computedAtMs: asDateMs(data?.computedAt),
      };
    })
    .filter((w): w is { gw: number; computedAtMs: number | null } => !!w)
    .sort((a, b) => a.gw - b.gw);

  const weeks: SeasonScoreWeek[] = await Promise.all(
    weeksBase.map(async (week) => {
      const usersSnap = await getDocs(
        collection(
          db,
          "rooms",
          upperRoom,
          "seasons",
          season,
          "scores",
          `gw-${week.gw}`,
          "users",
        ),
      );
      const users: SeasonScoreUserDoc[] = usersSnap.docs.map((userDoc) => {
        const data = userDoc.data() as {
          uid?: string;
          points?: number;
          breakdown?: Record<string, ScoreBreakdownItem>;
        };
        return {
          uid: String(data.uid ?? userDoc.id),
          points: Number(data.points ?? 0),
          breakdown: data.breakdown ?? {},
        };
      });
      return {
        gw: week.gw,
        computedAtMs: week.computedAtMs,
        users,
      };
    }),
  );

  const gameWeeksSnap = await getDocs(
    collection(db, "rooms", upperRoom, "seasons", season, "games"),
  );
  const gameWeeks = gameWeeksSnap.docs
    .map((d) => parseGwId(d.id))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);

  return {
    roomCode: upperRoom,
    seasonKey: season,
    fetchedAtMs: Date.now(),
    weeks,
    gameWeeks,
  };
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
      memCache.set(key, { expiresAt: Date.now() + TTL_MS, data: stored });
      return stored;
    }
  }

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const req = (async () => {
    try {
      const data = await fetchSnapshot(roomCode, seasonKey);
      memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
      setStorage(key, data);
      return data;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, req);
  return req;
}

export function prewarmSeasonScoresSnapshot(roomCode: string, seasonKey: string) {
  void getSeasonScoresSnapshotCached(roomCode, seasonKey).catch(() => {});
}

