"use client";

import { useCallback, useSyncExternalStore } from "react";
import { peekFixturesCached, type FixturesCachedData } from "./fixturesClient";
import { peekGameDataCached, type CachedGameData } from "./gameDataClient";
import { peekRoomBootstrapCached, type RoomBootstrapData } from "./roomBootstrapClient";
import { peekRoomPlayersCached, type CachedRoomPlayer } from "./roomPlayersClient";
import {
  peekSeasonScoresSnapshotCached,
  type SeasonScoresSnapshot,
} from "./seasonScoresClient";
import { peekTableCached, type TableData } from "./tableClient";
import {
  peekYearTableCached,
  type YearTableSnapshot,
} from "./yearTableClient";
import { readCachedSnapshot, subscribeRoomCache } from "./cacheStore";

const EMPTY_PLAYERS: CachedRoomPlayer[] = [];

function getServerNull() {
  return null;
}

function getServerEmptyPlayers() {
  return EMPTY_PLAYERS;
}

function useClientCache<T>(
  getClientSnapshot: () => T,
  getServerSnapshot: () => T,
): T {
  return useSyncExternalStore(
    subscribeRoomCache,
    getClientSnapshot,
    getServerSnapshot,
  );
}

export function useCachedBootstrap(
  roomCode: string,
): RoomBootstrapData | null {
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(`boot:${roomCode}`, () =>
        peekRoomBootstrapCached(roomCode),
      ),
    [roomCode],
  );
  return useClientCache(getClientSnapshot, getServerNull);
}

export function useCachedPlayers(roomCode: string): CachedRoomPlayer[] {
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(`players:${roomCode}`, () => {
        return peekRoomPlayersCached(roomCode) ?? EMPTY_PLAYERS;
      }),
    [roomCode],
  );
  return useClientCache(getClientSnapshot, getServerEmptyPlayers);
}

export function useCachedTable(seasonKey: string): TableData | null {
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(`table:${seasonKey}`, () =>
        seasonKey ? peekTableCached(seasonKey) : null,
      ),
    [seasonKey],
  );
  return useClientCache(getClientSnapshot, getServerNull);
}

export function useCachedFixtures(
  gameweek: number,
  seasonKey: string,
): FixturesCachedData | null {
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(`fx:${seasonKey}:gw:${gameweek}`, () =>
        peekFixturesCached(gameweek, seasonKey),
      ),
    [gameweek, seasonKey],
  );
  return useClientCache(getClientSnapshot, getServerNull);
}

export function useCachedGameData(
  roomCode: string,
  seasonKey: string,
  gw: number,
  opts?: { includeChips?: boolean },
): CachedGameData | null {
  const includeChips = opts?.includeChips;
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(
        `gdat:${roomCode}:${seasonKey}:gw:${gw}:${includeChips ? "full" : "picks"}`,
        () =>
          peekGameDataCached(roomCode, seasonKey, gw, {
            includeChips,
          }),
      ),
    [roomCode, seasonKey, gw, includeChips],
  );
  return useClientCache(getClientSnapshot, getServerNull);
}

export function useCachedSeasonScores(
  roomCode: string,
  seasonKey: string,
): SeasonScoresSnapshot | null {
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(`scores:${roomCode}:${seasonKey}`, () =>
        seasonKey
          ? peekSeasonScoresSnapshotCached(roomCode, seasonKey)
          : null,
      ),
    [roomCode, seasonKey],
  );
  return useClientCache(getClientSnapshot, getServerNull);
}

export function useCachedYearTable(
  roomCode: string,
  seasonKey: string,
  uid: string,
): YearTableSnapshot | null {
  const getClientSnapshot = useCallback(
    () =>
      readCachedSnapshot(`year:${roomCode}:${seasonKey}:${uid}`, () =>
        seasonKey && uid
          ? peekYearTableCached(roomCode, seasonKey, uid)
          : null,
      ),
    [roomCode, seasonKey, uid],
  );
  return useClientCache(getClientSnapshot, getServerNull);
}
