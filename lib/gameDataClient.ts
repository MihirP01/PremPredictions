import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { notifyRoomCache } from "./cacheStore";
import { peekSessionRecord, writeSessionRecord } from "./sessionCache";

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

function keyFor(
  roomCode: string,
  seasonKey: string,
  gw: number,
  includeChips = true,
) {
  return `${String(roomCode || "").toUpperCase()}:${String(seasonKey || "")}:gw-${Number(gw)}:${includeChips ? "full" : "picks"}`;
}

function peekCached(
  key: string,
): { expiresAt: number; data: CachedGameData } | null {
  const mem = memCache.get(key);
  if (mem) return mem;
  const stored = peekSessionRecord<CachedGameData>(STORAGE_PREFIX, key);
  if (!stored) return null;
  const data = {
    picks: Array.isArray(stored.data.picks) ? stored.data.picks : [],
    goldens: Array.isArray(stored.data.goldens) ? stored.data.goldens : [],
    powerups: Array.isArray(stored.data.powerups) ? stored.data.powerups : [],
  };
  const entry = { expiresAt: stored.expiresAt, data };
  memCache.set(key, entry);
  return entry;
}

function setCached(key: string, data: CachedGameData) {
  const expiresAt = writeSessionRecord(STORAGE_PREFIX, key, data, TTL_MS);
  memCache.set(key, { expiresAt, data });
  notifyRoomCache();
}

export function peekGameDataCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
  opts?: { includeChips?: boolean },
): CachedGameData | null {
  const includeChips = opts?.includeChips !== false;
  const normalizedGw = Number(gw);
  const normalizedSeason = String(seasonKey || "");
  const normalizedRoom = String(roomCode || "").toUpperCase();
  if (!normalizedRoom || !normalizedSeason || !Number.isFinite(normalizedGw)) {
    return null;
  }
  if (!includeChips) {
    const full = peekCached(
      keyFor(normalizedRoom, normalizedSeason, normalizedGw, true),
    );
    if (full) return full.data;
  }
  return (
    peekCached(
      keyFor(normalizedRoom, normalizedSeason, normalizedGw, includeChips),
    )?.data ?? null
  );
}

export async function getGameDataCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
  opts?: { includeChips?: boolean },
): Promise<CachedGameData> {
  const includeChips = opts?.includeChips !== false;
  const normalizedGw = Number(gw);
  const normalizedSeason = String(seasonKey || "");
  const normalizedRoom = String(roomCode || "").toUpperCase();
  if (!normalizedRoom || !normalizedSeason || !Number.isFinite(normalizedGw)) {
    return { picks: [], goldens: [], powerups: [] };
  }
  const key = keyFor(
    normalizedRoom,
    normalizedSeason,
    normalizedGw,
    includeChips,
  );
  const now = Date.now();
  if (!includeChips) {
    const fullKey = keyFor(
      normalizedRoom,
      normalizedSeason,
      normalizedGw,
      true,
    );
    const fullCached = peekCached(fullKey);
    if (fullCached) return fullCached.data;
  }
  const cached = peekCached(key);
  if (cached && cached.expiresAt > now) return cached.data;
  if (cached) {
    if (!pending.get(key)) {
      void fetchGameData(
        normalizedRoom,
        normalizedSeason,
        normalizedGw,
        includeChips,
        key,
      ).catch(() => {});
    }
    return cached.data;
  }
  return fetchGameData(
    normalizedRoom,
    normalizedSeason,
    normalizedGw,
    includeChips,
    key,
  );
}

function fetchGameData(
  room: string,
  season: string,
  gw: number,
  includeChips: boolean,
  key: string,
): Promise<CachedGameData> {
  const existing = pending.get(key);
  if (existing) return existing;
  const req = (async () => {
    const base = [
      "rooms",
      room,
      "seasons",
      season,
      "games",
      `gw-${gw}`,
    ] as const;
    const picksSnap = await getDocs(collection(db, ...base, "picks"));
    const [goldenSnap, powerupsSnap] = includeChips
      ? await Promise.all([
          getDocs(collection(db, ...base, "golden")),
          getDocs(collection(db, ...base, "powerups")),
        ])
      : [null, null];
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
    const goldens: CachedGolden[] = goldenSnap
      ? goldenSnap.docs
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
          .filter((g) => !!g.uid && Number.isFinite(g.fixtureId))
      : [];
    const powerups: CachedPowerup[] = powerupsSnap
      ? powerupsSnap.docs
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
          )
      : [];

    const payload = { picks, goldens, powerups } satisfies CachedGameData;
    setCached(key, payload);
    return payload;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}
