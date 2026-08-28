"use client";

import { refreshGameDataCached } from "./gameDataClient";
import { refreshRoomGameStateCached } from "./gameStateClient";
import { refreshRoomBootstrapCached } from "./roomBootstrapClient";
import { refreshRoomPlayersCached } from "./roomPlayersClient";

type GameDocLike = Record<string, unknown> | null;
type PickLike = { uid: string; fixtureId: number; score: string };
type GoldenLike = {
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
};
type PowerupLike = {
  uid: string;
  fixtureId: number;
  powerupType: "ALL_IN" | "SAFETY_NET";
  locked: boolean;
};
type RoomPlayerLike = {
  uid: string;
  displayName: string;
  nickName?: string;
  role?: "leader" | "member";
};
type RoomMetaLike = {
  leaderUid: string | null;
  settings: {
    sameResultLock: boolean;
    powerupsEnabled: boolean;
    gameModeStyle: "round_robin" | "sprint" | "captain" | "league";
    leagueFairPlayEnabled: boolean;
    themeAccent: string;
    hasPassword: boolean;
  };
};

type DataListener<T> = (data: T) => void;
type ErrorListener = (error: Error) => void;
type PollChannel<T> = {
  listeners: Set<DataListener<T>>;
  errorListeners: Set<ErrorListener>;
  stop: (() => void) | null;
};

const gameChannels = new Map<string, PollChannel<GameDocLike>>();
const picksChannels = new Map<string, PollChannel<PickLike[]>>();
const goldenChannels = new Map<string, PollChannel<GoldenLike[]>>();
const powerupsChannels = new Map<string, PollChannel<PowerupLike[]>>();
const roomPlayersChannels = new Map<string, PollChannel<RoomPlayerLike[]>>();
const roomMetaChannels = new Map<string, PollChannel<RoomMetaLike | null>>();

function keyFor(roomCode: string, seasonKey: string, gw: number) {
  return `${String(roomCode || "").toUpperCase()}:${seasonKey}:gw-${Number(gw)}`;
}

function createChannel<T>(): PollChannel<T> {
  return { listeners: new Set(), errorListeners: new Set(), stop: null };
}

function pollingChannel<T>(
  bucket: Map<string, PollChannel<T>>,
  key: string,
  onData: DataListener<T>,
  onError: ErrorListener | undefined,
  load: () => Promise<T>,
  intervalMs: number,
) {
  const channel = bucket.get(key) ?? createChannel<T>();
  bucket.set(key, channel);
  channel.listeners.add(onData);
  if (onError) channel.errorListeners.add(onError);

  if (!channel.stop) {
    let stopped = false;
    let inFlight = false;
    const run = async () => {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const data = await load();
        if (!stopped) channel.listeners.forEach((listener) => listener(data));
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Refresh failed");
        if (!stopped) channel.errorListeners.forEach((listener) => listener(normalized));
      } finally {
        inFlight = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    const timer = window.setInterval(run, intervalMs);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    void run();
    channel.stop = () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  return () => {
    channel.listeners.delete(onData);
    if (onError) channel.errorListeners.delete(onError);
    if (channel.listeners.size === 0 && channel.errorListeners.size === 0) {
      channel.stop?.();
      bucket.delete(key);
    }
  };
}

export function subscribeRoomGameDoc(
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<GameDocLike>,
  onError?: ErrorListener,
) {
  return pollingChannel(
    gameChannels,
    keyFor(roomCode, seasonKey, gw),
    onData,
    onError,
    () => refreshRoomGameStateCached(roomCode, seasonKey, gw),
    2500,
  );
}

function subscribeGameData<T>(
  bucket: Map<string, PollChannel<T>>,
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<T>,
  onError: ErrorListener | undefined,
  select: (data: Awaited<ReturnType<typeof refreshGameDataCached>>) => T,
) {
  return pollingChannel(
    bucket,
    keyFor(roomCode, seasonKey, gw),
    onData,
    onError,
    async () => select(await refreshGameDataCached(roomCode, seasonKey, gw)),
    2500,
  );
}

export function subscribeRoomPicks(
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<PickLike[]>,
  onError?: ErrorListener,
) {
  return subscribeGameData(picksChannels, roomCode, seasonKey, gw, onData, onError, (d) => d.picks);
}

export function subscribeRoomGoldens(
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<GoldenLike[]>,
  onError?: ErrorListener,
) {
  return subscribeGameData(goldenChannels, roomCode, seasonKey, gw, onData, onError, (d) => d.goldens);
}

export function subscribeRoomPowerups(
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<PowerupLike[]>,
  onError?: ErrorListener,
) {
  return subscribeGameData(powerupsChannels, roomCode, seasonKey, gw, onData, onError, (d) => d.powerups);
}

export function subscribeRoomPlayers(
  roomCode: string,
  onData: DataListener<RoomPlayerLike[]>,
  onError?: ErrorListener,
) {
  const key = String(roomCode || "").toUpperCase();
  return pollingChannel(
    roomPlayersChannels,
    key,
    onData,
    onError,
    () => refreshRoomPlayersCached(key),
    15_000,
  );
}

export function subscribeRoomMeta(
  roomCode: string,
  onData: DataListener<RoomMetaLike | null>,
  onError?: ErrorListener,
) {
  const key = String(roomCode || "").toUpperCase();
  return pollingChannel(
    roomMetaChannels,
    key,
    onData,
    onError,
    async () => {
      const room = await refreshRoomBootstrapCached(key);
      return {
        leaderUid: room.leaderUid,
        settings: {
          sameResultLock: !room.allowIdenticalPicks,
          powerupsEnabled: room.powerupsEnabled === true,
          gameModeStyle: room.gameModeStyle,
          leagueFairPlayEnabled: room.leagueFairPlayEnabled === true,
          themeAccent: room.themeAccent || "teal",
          hasPassword: room.hasPassword === true,
        },
      };
    },
    15_000,
  );
}
