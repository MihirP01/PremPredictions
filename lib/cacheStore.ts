"use client";

import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

export function notifyRoomCache() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeRoomCache(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRoomCacheVersion() {
  return version;
}

const snapshotCache = new Map<string, { version: number; value: unknown }>();

export function readCachedSnapshot<T>(key: string, read: () => T): T {
  const current = version;
  const prev = snapshotCache.get(key);
  if (prev && prev.version === current) return prev.value as T;
  const value = read();
  snapshotCache.set(key, { version: current, value });
  return value;
}

export function useRoomCacheVersion() {
  return useSyncExternalStore(
    subscribeRoomCache,
    getRoomCacheVersion,
    getRoomCacheVersion,
  );
}
