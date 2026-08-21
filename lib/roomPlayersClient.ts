import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { readFreshSessionRecord, writeSessionRecord } from "./sessionCache";

export type CachedRoomPlayer = {
  uid: string;
  displayName: string;
  nickName?: string;
  role?: "leader" | "member";
};

const TTL_MS = 15 * 1000;
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

function getStorage(key: string): { expiresAt: number; data: CachedRoomPlayer[] } | null {
  return readFreshSessionRecord<CachedRoomPlayer[]>(STORAGE_PREFIX, key);
}

function setCached(key: string, data: CachedRoomPlayer[]) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
}

export async function getRoomPlayersCached(
  roomCode: string,
): Promise<CachedRoomPlayer[]> {
  const key = keyFor(roomCode);
  if (!key) return [];
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.data;
  const stored = getStorage(key);
  if (stored) {
    memCache.set(key, stored);
    return stored.data;
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const snap = await getDocs(collection(db, "rooms", key, "players"));
    const list = snap.docs
      .map((d) => {
        const data = d.data() as {
          displayName?: string;
          nickName?: string;
          role?: "leader" | "member";
        };
        return {
          uid: d.id,
          displayName: String(data.displayName || "Player"),
          nickName: typeof data.nickName === "string" ? data.nickName : "",
          role: data.role,
        } satisfies CachedRoomPlayer;
      })
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
