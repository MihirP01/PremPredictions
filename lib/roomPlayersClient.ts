import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export type CachedRoomPlayer = {
  uid: string;
  displayName: string;
  nickName?: string;
  role?: "leader" | "member";
};

const TTL_MS = 60 * 1000;
const STORAGE_PREFIX = "rplayers:v1:";
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

function getStorage(key: string): CachedRoomPlayer[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      data?: CachedRoomPlayer[];
    };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function setStorage(key: string, data: CachedRoomPlayer[]) {
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

function setCached(key: string, data: CachedRoomPlayer[]) {
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  setStorage(key, data);
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
    memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
    return stored;
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
