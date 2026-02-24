import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

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
  powerupType: "DOUBLE";
  locked: boolean;
};

const TTL_MS = 30 * 1000;
const STORAGE_PREFIX = "gdat:v2:";
const memCache = new Map<string, { expiresAt: number; data: CachedGameData }>();
const pending = new Map<string, Promise<CachedGameData>>();

function keyFor(roomCode: string, seasonKey: string, gw: number) {
  return `${String(roomCode || "").toUpperCase()}:${String(seasonKey || "")}:gw-${Number(gw)}`;
}

function getStorage(key: string): CachedGameData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; data?: CachedGameData };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return {
      picks: Array.isArray(parsed.data.picks) ? parsed.data.picks : [],
      goldens: Array.isArray(parsed.data.goldens) ? parsed.data.goldens : [],
      powerups: Array.isArray((parsed.data as Partial<CachedGameData>).powerups)
        ? ((parsed.data as Partial<CachedGameData>).powerups as CachedPowerup[])
        : [],
    };
  } catch {
    return null;
  }
}

function setStorage(key: string, data: CachedGameData) {
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

function setCached(key: string, data: CachedGameData) {
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  setStorage(key, data);
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
    memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
    return stored;
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const req = (async () => {
    const base = ["rooms", normalizedRoom, "seasons", normalizedSeason, "games", `gw-${normalizedGw}`] as const;
    const [picksSnap, goldenSnap, powerupsSnap] = await Promise.all([
      getDocs(collection(db, ...base, "picks")),
      getDocs(collection(db, ...base, "golden")),
      getDocs(collection(db, ...base, "powerups")),
    ]);
    const picks: CachedPick[] = picksSnap.docs
      .map((d) => {
        const data = d.data() as { uid?: string; fixtureId?: number; score?: string };
        return {
          uid: String(data.uid || ""),
          fixtureId: Number(data.fixtureId),
          score: String(data.score || ""),
        } satisfies CachedPick;
      })
      .filter((p) => !!p.uid && Number.isFinite(p.fixtureId));
    const goldens: CachedGolden[] = goldenSnap.docs
      .map((d) => {
        const data = d.data() as { fixtureId?: number; score?: string; locked?: boolean };
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
        return {
          uid: d.id,
          fixtureId: Number(data.fixtureId),
          powerupType: String(data.powerupType || "").toUpperCase(),
          locked: Boolean(data.locked),
        };
      })
      .filter(
        (p): p is { uid: string; fixtureId: number; powerupType: "DOUBLE"; locked: boolean } =>
          !!p.uid && Number.isFinite(p.fixtureId) && p.powerupType === "DOUBLE",
      )
      .map((p) => ({
        uid: p.uid,
        fixtureId: p.fixtureId,
        powerupType: "DOUBLE" as const,
        locked: p.locked,
      }));

    const payload = { picks, goldens, powerups } satisfies CachedGameData;
    setCached(key, payload);
    return payload;
  })().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}
