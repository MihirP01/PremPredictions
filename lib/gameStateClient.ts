import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { readFreshSessionRecord, writeSessionRecord } from "./sessionCache";

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

const TTL_MS = 8 * 1000;
const STORAGE_PREFIX = "gstate:v2:";
const memCache = new Map<
  string,
  { expiresAt: number; data: CachedRoomGameState | null }
>();
const pending = new Map<string, Promise<CachedRoomGameState | null>>();

function keyFor(roomCode: string, seasonKey: string, gw: number) {
  return `${String(roomCode || "").toUpperCase()}:${String(seasonKey || "")}:gw-${Number(gw)}`;
}

function getStorage(key: string): { expiresAt: number; data: CachedRoomGameState | null } | undefined {
  const stored = readFreshSessionRecord<CachedRoomGameState | null>(STORAGE_PREFIX, key);
  if (!stored) return undefined;
  return stored;
}

function setCached(key: string, data: CachedRoomGameState | null) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
}

export async function getRoomGameStateCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
): Promise<CachedRoomGameState | null> {
  const normalizedGw = Number(gw);
  const normalizedSeason = String(seasonKey || "");
  const normalizedRoom = String(roomCode || "").toUpperCase();
  if (!normalizedRoom || !normalizedSeason || !Number.isFinite(normalizedGw))
    return null;

  const key = keyFor(normalizedRoom, normalizedSeason, normalizedGw);
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const stored = getStorage(key);
  if (stored !== undefined) {
    memCache.set(key, stored);
    return stored.data;
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
    const data = snap.exists()
      ? ((snap.data() as CachedRoomGameState) ?? null)
      : null;
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}
