import { authenticatedFetch } from "./authenticatedFetch";
import { notifyRoomCache } from "./cacheStore";
import { peekSessionRecord, writeSessionRecord } from "./sessionCache";

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
  firstKickoffAt?: unknown;
  leagueSubmittedByUid?: Record<string, boolean>;
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

function peekCached(
  key: string,
): { expiresAt: number; data: CachedRoomGameState | null } | null {
  const mem = memCache.get(key);
  if (mem) return mem;
  const stored = peekSessionRecord<CachedRoomGameState | null>(
    STORAGE_PREFIX,
    key,
  );
  if (!stored) return null;
  memCache.set(key, { expiresAt: stored.expiresAt, data: stored.data });
  return stored;
}

function setCached(key: string, data: CachedRoomGameState | null) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  notifyRoomCache();
}

function fetchGameState(
  room: string,
  season: string,
  gw: number,
  key: string,
): Promise<CachedRoomGameState | null> {
  const existing = pending.get(key);
  if (existing) return existing;
  const req = (async () => {
    const params = new URLSearchParams({
      roomCode: room,
      seasonKey: season,
      gameweek: String(gw),
    });
    const response = await authenticatedFetch(`/api/game/state?${params}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      game?: CachedRoomGameState | null;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || `game state ${response.status}`);
    }
    const data = payload.game ?? null;
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export function peekRoomGameStateCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
): CachedRoomGameState | null {
  const key = keyFor(
    String(roomCode || "").toUpperCase(),
    String(seasonKey || ""),
    Number(gw),
  );
  return peekCached(key)?.data ?? null;
}

export function writeRoomGameStateCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
  data: CachedRoomGameState | null,
) {
  const normalizedGw = Number(gw);
  const normalizedSeason = String(seasonKey || "");
  const normalizedRoom = String(roomCode || "").toUpperCase();
  if (!normalizedRoom || !normalizedSeason || !Number.isFinite(normalizedGw))
    return;
  setCached(keyFor(normalizedRoom, normalizedSeason, normalizedGw), data);
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
  const cached = peekCached(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  return fetchGameState(normalizedRoom, normalizedSeason, normalizedGw, key).catch(
    (error) => {
      if (cached) return cached.data;
      throw error;
    },
  );
}

export function refreshRoomGameStateCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
) {
  const room = String(roomCode || "").toUpperCase();
  const season = String(seasonKey || "");
  const gameweek = Number(gw);
  return fetchGameState(room, season, gameweek, keyFor(room, season, gameweek));
}
