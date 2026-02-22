import {
  collection,
  doc,
  onSnapshot,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase";

type GameDocLike = Record<string, unknown> | null;
type PickLike = { uid: string; fixtureId: number; score: string };
type GoldenLike = { uid: string; fixtureId: number; score: string; locked: boolean };
type RoomMetaLike = {
  leaderUid: string | null;
  settings: {
    sameResultLock: boolean;
    gameModeStyle: "round_robin" | "sprint" | "captain";
    themeAccent: string;
    hasPassword: boolean;
  };
};

type DataListener<T> = (data: T) => void;
type ErrorListener = (error: Error) => void;

type Channel<T> = {
  dataListeners: Set<DataListener<T>>;
  errorListeners: Set<ErrorListener>;
  firestoreUnsub: Unsubscribe | null;
};

const gameChannels = new Map<string, Channel<GameDocLike>>();
const picksChannels = new Map<string, Channel<PickLike[]>>();
const goldenChannels = new Map<string, Channel<GoldenLike[]>>();
const roomPlayersChannels = new Map<string, Channel<RoomPlayerLike[]>>();
const roomMetaChannels = new Map<string, Channel<RoomMetaLike | null>>();

type RoomPlayerLike = {
  uid: string;
  displayName: string;
  nickName?: string;
  role?: "leader" | "member";
};

function keyFor(roomCode: string, seasonKey: string, gw: number) {
  return `${String(roomCode || "").toUpperCase()}:${String(seasonKey || "")}:gw-${Number(gw)}`;
}

function createChannel<T>() {
  return {
    dataListeners: new Set<DataListener<T>>(),
    errorListeners: new Set<ErrorListener>(),
    firestoreUnsub: null,
  } satisfies Channel<T>;
}

function emitData<T>(ch: Channel<T>, data: T) {
  ch.dataListeners.forEach((cb) => cb(data));
}

function emitErr<T>(ch: Channel<T>, error: unknown) {
  const err = error instanceof Error ? error : new Error("Firestore listener failed");
  ch.errorListeners.forEach((cb) => cb(err));
}

function attachGameListener(roomCode: string, seasonKey: string, gw: number, ch: Channel<GameDocLike>) {
  const ref = doc(
    db,
    "rooms",
    roomCode.toUpperCase(),
    "seasons",
    seasonKey,
    "games",
    `gw-${gw}`,
  );
  ch.firestoreUnsub = onSnapshot(
    ref,
    (snap) => emitData(ch, snap.exists() ? ((snap.data() as Record<string, unknown>) ?? null) : null),
    (e) => emitErr(ch, e),
  );
}

function attachPicksListener(roomCode: string, seasonKey: string, gw: number, ch: Channel<PickLike[]>) {
  const q = query(
    collection(
      db,
      "rooms",
      roomCode.toUpperCase(),
      "seasons",
      seasonKey,
      "games",
      `gw-${gw}`,
      "picks",
    ),
  );
  ch.firestoreUnsub = onSnapshot(
    q,
    (snap) => {
      const picks = snap.docs
        .map((d) => {
          const data = d.data() as { uid?: string; fixtureId?: number; score?: string };
          return {
            uid: String(data.uid || d.id),
            fixtureId: Number(data.fixtureId),
            score: String(data.score || ""),
          } satisfies PickLike;
        })
        .filter((p) => !!p.uid && Number.isFinite(p.fixtureId));
      emitData(ch, picks);
    },
    (e) => emitErr(ch, e),
  );
}

function attachGoldenListener(roomCode: string, seasonKey: string, gw: number, ch: Channel<GoldenLike[]>) {
  const q = query(
    collection(
      db,
      "rooms",
      roomCode.toUpperCase(),
      "seasons",
      seasonKey,
      "games",
      `gw-${gw}`,
      "golden",
    ),
  );
  ch.firestoreUnsub = onSnapshot(
    q,
    (snap) => {
      const goldens = snap.docs
        .map((d) => {
          const data = d.data() as { fixtureId?: number; score?: string; locked?: boolean };
          return {
            uid: d.id,
            fixtureId: Number(data.fixtureId),
            score: String(data.score || ""),
            locked: Boolean(data.locked),
          } satisfies GoldenLike;
        })
        .filter((g) => !!g.uid && Number.isFinite(g.fixtureId));
      emitData(ch, goldens);
    },
    (e) => emitErr(ch, e),
  );
}

function subscribeChannel<T>(
  bucket: Map<string, Channel<T>>,
  key: string,
  onData: DataListener<T>,
  onError: ErrorListener | undefined,
  attach: (ch: Channel<T>) => void,
) {
  const channel = bucket.get(key) ?? createChannel<T>();
  bucket.set(key, channel);
  channel.dataListeners.add(onData);
  if (onError) channel.errorListeners.add(onError);
  if (!channel.firestoreUnsub) attach(channel);

  return () => {
    channel.dataListeners.delete(onData);
    if (onError) channel.errorListeners.delete(onError);
    if (channel.dataListeners.size === 0 && channel.errorListeners.size === 0) {
      if (channel.firestoreUnsub) channel.firestoreUnsub();
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
  const key = keyFor(roomCode, seasonKey, gw);
  return subscribeChannel(
    gameChannels,
    key,
    onData,
    onError,
    (ch) => attachGameListener(roomCode, seasonKey, gw, ch),
  );
}

export function subscribeRoomPicks(
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<PickLike[]>,
  onError?: ErrorListener,
) {
  const key = keyFor(roomCode, seasonKey, gw);
  return subscribeChannel(
    picksChannels,
    key,
    onData,
    onError,
    (ch) => attachPicksListener(roomCode, seasonKey, gw, ch),
  );
}

export function subscribeRoomGoldens(
  roomCode: string,
  seasonKey: string,
  gw: number,
  onData: DataListener<GoldenLike[]>,
  onError?: ErrorListener,
) {
  const key = keyFor(roomCode, seasonKey, gw);
  return subscribeChannel(
    goldenChannels,
    key,
    onData,
    onError,
    (ch) => attachGoldenListener(roomCode, seasonKey, gw, ch),
  );
}

function attachRoomPlayersListener(roomCode: string, ch: Channel<RoomPlayerLike[]>) {
  const q = query(collection(db, "rooms", roomCode.toUpperCase(), "players"));
  ch.firestoreUnsub = onSnapshot(
    q,
    (snap) => {
      const players = snap.docs
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
          } satisfies RoomPlayerLike;
        })
        .sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
        );
      emitData(ch, players);
    },
    (e) => emitErr(ch, e),
  );
}

export function subscribeRoomPlayers(
  roomCode: string,
  onData: DataListener<RoomPlayerLike[]>,
  onError?: ErrorListener,
) {
  const key = String(roomCode || "").toUpperCase();
  return subscribeChannel(
    roomPlayersChannels,
    key,
    onData,
    onError,
    (ch) => attachRoomPlayersListener(roomCode, ch),
  );
}

function attachRoomMetaListener(roomCode: string, ch: Channel<RoomMetaLike | null>) {
  const ref = doc(db, "rooms", roomCode.toUpperCase());
  ch.firestoreUnsub = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        emitData(ch, null);
        return;
      }
      const data = snap.data() as {
        leaderUid?: string;
        settings?: {
          sameResultLock?: boolean;
          gameModeStyle?: "round_robin" | "sprint" | "captain";
          themeAccent?: string;
          hasPassword?: boolean;
        };
      };
      const sameResultLock = data?.settings?.sameResultLock !== false;
      emitData(ch, {
        leaderUid: data?.leaderUid ?? null,
        settings: {
          sameResultLock,
          gameModeStyle:
            data?.settings?.gameModeStyle ??
            (sameResultLock ? "round_robin" : "sprint"),
          themeAccent: String(data?.settings?.themeAccent || "teal"),
          hasPassword: Boolean(data?.settings?.hasPassword),
        },
      });
    },
    (e) => emitErr(ch, e),
  );
}

export function subscribeRoomMeta(
  roomCode: string,
  onData: DataListener<RoomMetaLike | null>,
  onError?: ErrorListener,
) {
  const key = String(roomCode || "").toUpperCase();
  return subscribeChannel(
    roomMetaChannels,
    key,
    onData,
    onError,
    (ch) => attachRoomMetaListener(roomCode, ch),
  );
}
