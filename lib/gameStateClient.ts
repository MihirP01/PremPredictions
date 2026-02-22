import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export type CachedRoomGameState = {
  state?: string;
  players?: string[];
  order?: string[];
  fixtureIds?: number[];
  forcedReveal?: boolean;
  sameResultLock?: boolean;
  currentTurn?: number;
  currentFixtureId?: number;
  uidTurn?: string;
  captainCycleIndex?: number;
  captainFixtureStage?: boolean;
  lockAt?: unknown;
};

const TTL_MS = 20 * 1000;
const STORAGE_PREFIX = "gstate:v1:";
const memCache = new Map<string, { expiresAt: number; data: CachedRoomGameState | null }>();
const pending = new Map<string, Promise<CachedRoomGameState | null>>();

function keyFor(roomCode: string, seasonKey: string, gw: number) {
  return `${String(roomCode || "").toUpperCase()}:${String(seasonKey || "")}:gw-${Number(gw)}`;
}

function getStorage(key: string): CachedRoomGameState | null | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { expiresAt?: number; data?: CachedRoomGameState | null };
    if (!parsed?.expiresAt) return undefined;
    if (Date.now() > parsed.expiresAt) return undefined;
    return parsed.data ?? null;
  } catch {
    return undefined;
  }
}

function setStorage(key: string, data: CachedRoomGameState | null) {
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

function setCached(key: string, data: CachedRoomGameState | null) {
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  setStorage(key, data);
}

export async function getRoomGameStateCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
): Promise<CachedRoomGameState | null> {
  const normalizedGw = Number(gw);
  const normalizedSeason = String(seasonKey || "");
  const normalizedRoom = String(roomCode || "").toUpperCase();
  if (!normalizedRoom || !normalizedSeason || !Number.isFinite(normalizedGw)) return null;

  const key = keyFor(normalizedRoom, normalizedSeason, normalizedGw);
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const stored = getStorage(key);
  if (stored !== undefined) {
    memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
    return stored;
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const ref = doc(
      db,
      "rooms",
      normalizedRoom,
      "seasons",
      normalizedSeason,
      "games",
      `gw-${normalizedGw}`,
    );
    const snap = await getDoc(ref);
    const data = snap.exists() ? ((snap.data() as CachedRoomGameState) ?? null) : null;
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}

