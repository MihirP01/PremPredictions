import { primeCurrentGameweekCache } from "./currentGameweekClient";
import {
  readFreshSessionRecord,
  writeSessionRecord,
} from "./sessionCache";

export type RoomBootstrapData = {
  ok: boolean;
  roomCode: string;
  seasonKey: string;
  currentGameweek: number;
  gameState: string;
  leaderUid: string | null;
  themeAccent: string;
  gameModeStyle: "round_robin" | "sprint" | "captain" | "league";
  allowIdenticalPicks: boolean;
  powerupsEnabled?: boolean;
  leagueFairPlayEnabled?: boolean;
  seasonOptions?: string[];
};

const TTL_MS = 15 * 1000;
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

function getStorage(key: string): { expiresAt: number; data: RoomBootstrapData } | null {
  return readFreshSessionRecord<RoomBootstrapData>(STORAGE_PREFIX, key);
}

function setCached(key: string, data: RoomBootstrapData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  primeCurrentGameweekCache({
    currentGameweek: data.currentGameweek,
    seasonKey: data.seasonKey,
  });
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
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const stored = getStorage(key);
  if (!stored) return null;
  memCache.set(key, stored);
  primeCurrentGameweekCache({
    currentGameweek: stored.data.currentGameweek,
    seasonKey: stored.data.seasonKey,
  });
  return stored.data;
}

export async function getRoomBootstrapCached(
  roomCode: string,
): Promise<RoomBootstrapData> {
  const key = keyFor(roomCode);
  const cached = peekRoomBootstrapCached(roomCode);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const res = await fetch(
      `/api/bootstrap?roomCode=${encodeURIComponent(key)}`,
      {
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`bootstrap ${res.status}`);
    const data = (await res.json()) as RoomBootstrapData;
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export async function refreshRoomBootstrapCached(
  roomCode: string,
): Promise<RoomBootstrapData> {
  const key = keyFor(roomCode);
  const res = await fetch(
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
