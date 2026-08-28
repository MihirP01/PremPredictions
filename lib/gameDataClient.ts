import { authenticatedFetch } from "./authenticatedFetch";
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

  // Prefer the exact representation requested by the caller. A picks-only
  // refresh must not be hidden by an older full (picks + chips) snapshot.
  const exact = peekCached(
    keyFor(normalizedRoom, normalizedSeason, normalizedGw, includeChips),
  );
  if (exact) return exact.data;

  // A full snapshot is still a valid fallback for a picks-only reader when
  // no dedicated picks snapshot has been loaded yet.
  if (!includeChips) {
    const full = peekCached(
      keyFor(normalizedRoom, normalizedSeason, normalizedGw, true),
    );
    if (full) return full.data;
  }
  return null;
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
  const cached = peekCached(key);
  if (cached && cached.expiresAt > now) return cached.data;

  if (!includeChips && !cached) {
    const fullKey = keyFor(
      normalizedRoom,
      normalizedSeason,
      normalizedGw,
      true,
    );
    const fullCached = peekCached(fullKey);
    if (fullCached && fullCached.expiresAt > now) return fullCached.data;
  }

  return fetchGameData(
    normalizedRoom,
    normalizedSeason,
    normalizedGw,
    includeChips,
    key,
  ).catch((error) => {
    if (cached) return cached.data;
    throw error;
  });
}

export function refreshGameDataCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
  opts?: { includeChips?: boolean },
) {
  const includeChips = opts?.includeChips !== false;
  const room = String(roomCode || "").toUpperCase();
  const season = String(seasonKey || "");
  const gameweek = Number(gw);
  return fetchGameData(
    room,
    season,
    gameweek,
    includeChips,
    keyFor(room, season, gameweek, includeChips),
  );
}

export function patchGameDataPicksCached(
  roomCode: string,
  seasonKey: string,
  gw: number,
  uid: string,
  picks: Array<{ fixtureId: number; score: string }>,
) {
  const room = String(roomCode || "").toUpperCase();
  const season = String(seasonKey || "");
  const gameweek = Number(gw);
  if (!room || !season || !uid || !Number.isFinite(gameweek)) return;

  for (const includeChips of [false, true]) {
    const key = keyFor(room, season, gameweek, includeChips);
    const existing = peekCached(key);
    if (includeChips && !existing) continue;
    const byFixture = new Map(
      (existing?.data.picks ?? []).map((pick) => [
        `${pick.uid}|${pick.fixtureId}`,
        pick,
      ]),
    );
    for (const pick of picks) {
      if (!Number.isFinite(Number(pick.fixtureId))) continue;
      const next: CachedPick = {
        uid,
        fixtureId: Number(pick.fixtureId),
        score: String(pick.score || ""),
      };
      byFixture.set(`${uid}|${next.fixtureId}`, next);
    }
    setCached(key, {
      picks: [...byFixture.values()],
      goldens: existing?.data.goldens ?? [],
      powerups: existing?.data.powerups ?? [],
    });
  }
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
    const params = new URLSearchParams({
      roomCode: room,
      seasonKey: season,
      gameweek: String(gw),
      includeChips: includeChips ? "1" : "0",
    });
    const response = await authenticatedFetch(`/api/game/data?${params}`, {
      cache: "no-store",
    });
    const payload = (await response
      .json()
      .catch(() => ({}))) as Partial<CachedGameData> & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || `game data ${response.status}`);
    }
    const picks: CachedPick[] = (
      Array.isArray(payload.picks) ? payload.picks : []
    )
      .map((data) => {
        return {
          uid: String(data.uid || ""),
          fixtureId: Number(data.fixtureId),
          score: String(data.score || ""),
        } satisfies CachedPick;
      })
      .filter((p) => !!p.uid && Number.isFinite(p.fixtureId));
    const goldens: CachedGolden[] = Array.isArray(payload.goldens)
      ? payload.goldens
          .map((data) => {
            return {
              uid: String(data.uid || ""),
              fixtureId: Number(data.fixtureId),
              score: String(data.score || ""),
              locked: Boolean(data.locked),
            } satisfies CachedGolden;
          })
          .filter((g) => !!g.uid && Number.isFinite(g.fixtureId))
      : [];
    const powerups: CachedPowerup[] = Array.isArray(payload.powerups)
      ? payload.powerups
          .map((data) => {
            const rawType = String(data.powerupType || "").toUpperCase();
            const normalizedType =
              rawType === "ALL_IN" || rawType === "SAFETY_NET" ? rawType : null;
            return {
              uid: String(data.uid || ""),
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

    const data = { picks, goldens, powerups } satisfies CachedGameData;
    setCached(key, data);
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, req);
  return req;
}
