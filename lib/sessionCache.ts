export type SessionCacheRecord<T> = {
  expiresAt: number;
  data: T;
};

export function readSessionRecord<T>(
  prefix: string,
  key: string,
): SessionCacheRecord<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(prefix + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      data?: T;
    };
    if (!parsed || typeof parsed.expiresAt !== "number" || !("data" in parsed)) {
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

export function writeSessionRecord<T>(
  prefix: string,
  key: string,
  data: T,
  ttlMs: number,
) {
  if (typeof window === "undefined") return Date.now() + ttlMs;
  const expiresAt = Date.now() + ttlMs;
  try {
    window.sessionStorage.setItem(
      prefix + key,
      JSON.stringify({ expiresAt, data }),
    );
  } catch {
    // ignore quota / private-mode failures
  }
  return expiresAt;
}
