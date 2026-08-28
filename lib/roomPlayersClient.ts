import { authenticatedFetch } from "./authenticatedFetch";
import { notifyRoomCache } from "./cacheStore";
import { peekSessionRecord, writeSessionRecord } from "./sessionCache";

export type CachedRoomPlayer = {
  uid: string;
  displayName: string;
  nickName?: string;
  role?: "leader" | "member";
};

const TTL_MS = 60 * 1000;
const STORAGE_PREFIX = "rplayers:v2:";
const memCache = new Map<
  string,
  { expiresAt: number; data: CachedRoomPlayer[] }
>();
const pending = new Map<string, Promise<CachedRoomPlayer[]>>();

function keyFor(roomCode: string) {
  return String(roomCode || "")
    .trim()
    .toUpperCase();
}

function peekCached(
  key: string,
): { expiresAt: number; data: CachedRoomPlayer[] } | null {
  const mem = memCache.get(key);
  if (mem) return mem;
  const stored = peekSessionRecord<CachedRoomPlayer[]>(STORAGE_PREFIX, key);
  if (!stored) return null;
  const entry = { expiresAt: stored.expiresAt, data: stored.data };
  memCache.set(key, entry);
  return entry;
}

function setCached(key: string, data: CachedRoomPlayer[]) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  notifyRoomCache();
}

export function writeRoomPlayersCached(
  roomCode: string,
  data: CachedRoomPlayer[],
) {
  const key = keyFor(roomCode);
  if (!key) return;
  setCached(key, data);
}

function fetchPlayers(key: string): Promise<CachedRoomPlayer[]> {
  const existing = pending.get(key);
  if (existing) return existing;
  const req = (async () => {
    const response = await authenticatedFetch(
      `/api/room/players?roomCode=${encodeURIComponent(key)}`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      players?: CachedRoomPlayer[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || `players ${response.status}`);
    }
    const list = (Array.isArray(payload.players) ? payload.players : [])
      .map((data) => {
        return {
          uid: String(data.uid || ""),
          displayName: String(data.displayName || "Player"),
          nickName: typeof data.nickName === "string" ? data.nickName : "",
          role: data.role === "leader" ? "leader" : "member",
        } satisfies CachedRoomPlayer;
      })
      .filter((player) => Boolean(player.uid))
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        }),
      );
    setCached(key, list);
    return list;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}

export function peekRoomPlayersCached(
  roomCode: string,
): CachedRoomPlayer[] | null {
  const key = keyFor(roomCode);
  if (!key) return null;
  return peekCached(key)?.data ?? null;
}

export async function getRoomPlayersCached(
  roomCode: string,
): Promise<CachedRoomPlayer[]> {
  const key = keyFor(roomCode);
  if (!key) return [];
  const cached = peekCached(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  return fetchPlayers(key).catch((error) => {
    if (cached) return cached.data;
    throw error;
  });
}

export function refreshRoomPlayersCached(roomCode: string) {
  const key = keyFor(roomCode);
  if (!key) return Promise.resolve([]);
  return fetchPlayers(key);
}
