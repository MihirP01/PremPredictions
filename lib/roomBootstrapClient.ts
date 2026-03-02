import { primeCurrentGameweekCache } from "./currentGameweekClient";

export type RoomBootstrapData = {
  ok: boolean;
  roomCode: string;
  seasonKey: string;
  currentGameweek: number;
  gameState: string;
  leaderUid: string | null;
  themeAccent: string;
  gameModeStyle: "round_robin" | "sprint" | "captain";
  allowIdenticalPicks: boolean;
  powerupsEnabled?: boolean;
  seasonOptions?: string[];
};

const TTL_MS = 5 * 60 * 1000;
const STORAGE_PREFIX = "rb:v1:";
const memCache = new Map<string, { expiresAt: number; data: RoomBootstrapData }>();
const pending = new Map<string, Promise<RoomBootstrapData>>();

function keyFor(roomCode: string) {
  return String(roomCode || "").trim().toUpperCase();
}

function getStorage(key: string): RoomBootstrapData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; data?: RoomBootstrapData };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function setStorage(key: string, data: RoomBootstrapData) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({ expiresAt: Date.now() + TTL_MS, data }),
    );
  } catch {
    // ignore
  }
}

function setCached(key: string, data: RoomBootstrapData) {
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  setStorage(key, data);
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

export function peekRoomBootstrapCached(roomCode: string): RoomBootstrapData | null {
  const key = keyFor(roomCode);
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const stored = getStorage(key);
  if (!stored) return null;
  memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
  primeCurrentGameweekCache({
    currentGameweek: stored.currentGameweek,
    seasonKey: stored.seasonKey,
  });
  return stored;
}

export async function getRoomBootstrapCached(roomCode: string): Promise<RoomBootstrapData> {
  const key = keyFor(roomCode);
  const cached = peekRoomBootstrapCached(roomCode);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const res = await fetch(`/api/bootstrap?roomCode=${encodeURIComponent(key)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`bootstrap ${res.status}`);
    const data = (await res.json()) as RoomBootstrapData;
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export async function refreshRoomBootstrapCached(roomCode: string): Promise<RoomBootstrapData> {
  const key = keyFor(roomCode);
  const res = await fetch(`/api/bootstrap?roomCode=${encodeURIComponent(key)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const data = (await res.json()) as RoomBootstrapData;
  setCached(key, data);
  return data;
}
