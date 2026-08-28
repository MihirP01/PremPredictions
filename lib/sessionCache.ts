export type SessionCacheRecord<T> = {
  expiresAt: number;
  data: T;
};

const CACHE_INDEX_KEY = "pp-cache:index:v1";
const CACHE_OWNER_KEY = "pp-cache:owner:v1";
const CACHE_SCHEMA_KEY = "pp-cache:schema";
const CACHE_SCHEMA = "postgres-v1";
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_PREFIXES = [
  "seasonScores:",
  "rb:",
  "gdat:",
  "gstate:",
  "rplayers:",
  "fx:",
  "cgw:",
  "tbl:",
];

function readRaw(key: string) {
  try {
    return (
      window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
    );
  } catch {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

function trackKey(key: string) {
  try {
    const current = JSON.parse(
      window.localStorage.getItem(CACHE_INDEX_KEY) || "[]",
    ) as unknown;
    const keys = new Set(Array.isArray(current) ? current.map(String) : []);
    keys.add(key);
    window.localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify([...keys]));
  } catch {
    // Persistence is an enhancement; in-memory caching still works.
  }
}

export function clearPersistentRoomCache() {
  if (typeof window === "undefined") return;
  try {
    const current = JSON.parse(
      window.localStorage.getItem(CACHE_INDEX_KEY) || "[]",
    ) as unknown;
    const keys = Array.isArray(current) ? current.map(String) : [];
    for (const key of keys) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
    window.localStorage.removeItem(CACHE_INDEX_KEY);
  } catch {
    // Ignore storage failures and continue logging out.
  }
}

/** Clear only app data snapshots when the storage model changes; auth survives. */
export function migratePersistentRoomCache() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(CACHE_SCHEMA_KEY) === CACHE_SCHEMA) return;
    clearPersistentRoomCache();
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const remove: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          remove.push(key);
        }
      }
      remove.forEach((key) => storage.removeItem(key));
    }
    window.localStorage.setItem(CACHE_SCHEMA_KEY, CACHE_SCHEMA);
  } catch {
    // Private mode/storage denial: network reads remain authoritative.
  }
}

export function setPersistentRoomCacheOwner(uid: string | null) {
  if (typeof window === "undefined") return;
  try {
    const previous = window.localStorage.getItem(CACHE_OWNER_KEY);
    if (!uid || (previous && previous !== uid)) {
      clearPersistentRoomCache();
    }
    if (uid) window.localStorage.setItem(CACHE_OWNER_KEY, uid);
    else window.localStorage.removeItem(CACHE_OWNER_KEY);
  } catch {
    // Ignore private-mode and quota failures.
  }
}

export function readSessionRecord<T>(
  prefix: string,
  key: string,
): SessionCacheRecord<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const storageKey = prefix + key;
    const raw = readRaw(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      data?: T;
    };
    if (
      !parsed ||
      typeof parsed.expiresAt !== "number" ||
      !("data" in parsed)
    ) {
      return null;
    }
    if (parsed.expiresAt < Date.now() - MAX_STALE_MS) {
      window.localStorage.removeItem(storageKey);
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    return { expiresAt: parsed.expiresAt, data: parsed.data as T };
  } catch {
    return null;
  }
}

export function readFreshSessionRecord<T>(
  prefix: string,
  key: string,
): SessionCacheRecord<T> | null {
  const record = readSessionRecord<T>(prefix, key);
  if (!record || Date.now() > record.expiresAt) return null;
  return record;
}

export function peekSessionRecord<T>(
  prefix: string,
  key: string,
): (SessionCacheRecord<T> & { fresh: boolean }) | null {
  const record = readSessionRecord<T>(prefix, key);
  if (!record) return null;
  return {
    ...record,
    fresh: Date.now() <= record.expiresAt,
  };
}

export function writeSessionRecord<T>(
  prefix: string,
  key: string,
  data: T,
  ttlMs: number,
) {
  if (typeof window === "undefined") return Date.now() + ttlMs;
  const expiresAt = Date.now() + ttlMs;
  const storageKey = prefix + key;
  const serialized = JSON.stringify({ expiresAt, data });
  try {
    window.localStorage.setItem(storageKey, serialized);
    trackKey(storageKey);
  } catch {
    try {
      window.sessionStorage.setItem(storageKey, serialized);
    } catch {
      // Ignore quota and private-mode failures.
    }
  }
  return expiresAt;
}
