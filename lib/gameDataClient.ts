import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { readFreshSessionRecord, writeSessionRecord } from "./sessionCache";

export type CachedPick = {
  uid: string;
  fixtureId: number;
  score: string;
};

export type CachedGolden = {
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
};

export type CachedGameData = {
  picks: CachedPick[];
  goldens: CachedGolden[];
  powerups: CachedPowerup[];
};

export type CachedPowerup = {
  uid: string;
  fixtureId: number;
  powerupType: "ALL_IN" | "SAFETY_NET";
  locked: boolean;
};

const TTL_MS = 8 * 1000;
const STORAGE_PREFIX = "gdat:v3:";
const memCache = new Map<string, { expiresAt: number; data: CachedGameData }>();
const pending = new Map<string, Promise<CachedGameData>>();

function keyFor(roomCode: string, seasonKey: string, gw: number) {
  return `${String(roomCode || "").toUpperCase()}:${String(seasonKey || "")}:gw-${Number(gw)}`;
}

function getStorage(key: string): { expiresAt: number; data: CachedGameData } | null {
  const stored = readFreshSessionRecord<CachedGameData>(STORAGE_PREFIX, key);
  if (!stored) return null;
  return {
    expiresAt: stored.expiresAt,
    data: {
      picks: Array.isArray(stored.data.picks) ? stored.data.picks : [],
      goldens: Array.isArray(stored.data.goldens) ? stored.data.goldens : [],
      powerups: Array.isArray(stored.data.powerups) ? stored.data.powerups : [],
    },
  };
}

function setCached(key: string, data: CachedGameData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
}

export async function getGameDataCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
): Promise<CachedGameData> {
  const normalizedGw = Number(gw);
  const normalizedSeason = String(seasonKey || "");
  const normalizedRoom = String(roomCode || "").toUpperCase();
  if (!normalizedRoom || !normalizedSeason || !Number.isFinite(normalizedGw)) {
    return { picks: [], goldens: [], powerups: [] };
  }
  const key = keyFor(normalizedRoom, normalizedSeason, normalizedGw);
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
    const base = [
      "rooms",
      normalizedRoom,
      "seasons",
      normalizedSeason,
      "games",
      `gw-${normalizedGw}`,
    ] as const;
    const [picksSnap, goldenSnap, powerupsSnap] = await Promise.all([
      getDocs(collection(db, ...base, "picks")),
      getDocs(collection(db, ...base, "golden")),
      getDocs(collection(db, ...base, "powerups")),
    ]);
    const picks: CachedPick[] = picksSnap.docs
      .map((d) => {
        const data = d.data() as {
          uid?: string;
          fixtureId?: number;
          score?: string;
        };
        return {
          uid: String(data.uid || ""),
          fixtureId: Number(data.fixtureId),
          score: String(data.score || ""),
        } satisfies CachedPick;
      })
      .filter((p) => !!p.uid && Number.isFinite(p.fixtureId));
    const goldens: CachedGolden[] = goldenSnap.docs
      .map((d) => {
        const data = d.data() as {
          fixtureId?: number;
          score?: string;
          locked?: boolean;
        };
        return {
          uid: d.id,
          fixtureId: Number(data.fixtureId),
          score: String(data.score || ""),
          locked: Boolean(data.locked),
        } satisfies CachedGolden;
      })
      .filter((g) => !!g.uid && Number.isFinite(g.fixtureId));
    const powerups: CachedPowerup[] = powerupsSnap.docs
      .map((d) => {
        const data = d.data() as {
          fixtureId?: number;
          powerupType?: string;
          locked?: boolean;
        };
        const rawType = String(data.powerupType || "").toUpperCase();
        const normalizedType =
          rawType === "ALL_IN" || rawType === "SAFETY_NET" ? rawType : null;
        return {
          uid: d.id,
          fixtureId: Number(data.fixtureId),
          powerupType: normalizedType,
          locked: Boolean(data.locked),
        };
      })
      .filter(
        (
          p,
        ): p is {
          uid: string;
          fixtureId: number;
          powerupType: "ALL_IN" | "SAFETY_NET";
          locked: boolean;
        } => !!p.uid && Number.isFinite(p.fixtureId) && !!p.powerupType,
      );

    const payload = { picks, goldens, powerups } satisfies CachedGameData;
    setCached(key, payload);
    return payload;
  })().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}
