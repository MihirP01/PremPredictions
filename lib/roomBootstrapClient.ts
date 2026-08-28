import { notifyRoomCache } from "./cacheStore";
import { authenticatedFetch } from "./authenticatedFetch";
import { primeCurrentGameweekCache } from "./currentGameweekClient";
import { peekSessionRecord, writeSessionRecord } from "./sessionCache";

export type RoomBootstrapData = {
  ok: boolean;
  roomCode: string;
  seasonKey: string;
  currentGameweek: number;
  predictionLockAt?: string | null;
  nextGameweekAt?: string | null;
  gameState: string;
  leaderUid: string | null;
  themeAccent: string;
  gameModeStyle: "round_robin" | "sprint" | "captain" | "league";
  allowIdenticalPicks: boolean;
  powerupsEnabled?: boolean;
  leagueFairPlayEnabled?: boolean;
  hasPassword?: boolean;
  seasonOptions?: string[];
};

const TTL_MS = 2 * 60 * 1000;
const STORAGE_PREFIX = "rb:v2:";
const memCache = new Map<
  string,
  { expiresAt: number; data: RoomBootstrapData }
>();
const pending = new Map<string, Promise<RoomBootstrapData>>();

function keyFor(roomCode: string) {
  return String(roomCode || "")
    .trim()
    .toUpperCase();
}

function peekCached(
  key: string,
): { expiresAt: number; data: RoomBootstrapData } | null {
  const mem = memCache.get(key);
  if (mem) return mem;
  const stored = peekSessionRecord<RoomBootstrapData>(STORAGE_PREFIX, key);
  if (!stored) return null;
  const entry = { expiresAt: stored.expiresAt, data: stored.data };
  memCache.set(key, entry);
  return entry;
}

function setCached(key: string, data: RoomBootstrapData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  notifyRoomCache();
  primeCurrentGameweekCache(
    {
      currentGameweek: data.currentGameweek,
      seasonKey: data.seasonKey,
      predictionLockAt: data.predictionLockAt ?? null,
      nextGameweekAt: data.nextGameweekAt ?? null,
    },
    data.gameModeStyle === "league" ? "league" : "live",
  );
}

export function patchRoomBootstrapCached(
  roomCode: string,
  patch: Partial<RoomBootstrapData>,
): RoomBootstrapData | null {
  const current = peekRoomBootstrapCached(roomCode);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
  };
  setCached(keyFor(roomCode), next);
  return next;
}

export function peekRoomBootstrapCached(
  roomCode: string,
): RoomBootstrapData | null {
  const key = keyFor(roomCode);
  const cached = peekCached(key);
  return cached?.data ?? null;
}

export async function getRoomBootstrapCached(
  roomCode: string,
): Promise<RoomBootstrapData> {
  const key = keyFor(roomCode);
  const cached = peekCached(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const res = await authenticatedFetch(
      `/api/bootstrap?roomCode=${encodeURIComponent(key)}`,
      {
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`bootstrap ${res.status}`);
    const data = (await res.json()) as RoomBootstrapData;
    setCached(key, data);
    return data;
  })()
    .catch((error) => {
      if (cached) return cached.data;
      throw error;
    })
    .finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export async function refreshRoomBootstrapCached(
  roomCode: string,
): Promise<RoomBootstrapData> {
  const key = keyFor(roomCode);
  const res = await authenticatedFetch(
    `/api/bootstrap?roomCode=${encodeURIComponent(key)}`,
    {
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const data = (await res.json()) as RoomBootstrapData;
  setCached(key, data);
  return data;
}
