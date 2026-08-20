import { adminDb } from "../../../firebase-admin";
import { getBaseUrl, loadGwFixturesWithLockWindow } from "./lock-window";

type RoomDoc = {
  leaderUid?: string;
  settings?: {
    leagueFairPlayEnabled?: boolean;
    gameModeStyle?: "round_robin" | "sprint" | "captain" | "league";
  };
};

type GameDoc = {
  state?: string;
  players?: string[];
  order?: string[];
  fixtureIds?: number[];
  gameModeStyle?: string;
  leagueSubmittedByUid?: Record<string, boolean>;
  voidedFixtureIds?: number[];
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export async function ensureLeagueDraftGame(opts: {
  req: Request;
  roomCode: string;
  gw: number;
  seasonKey: string;
  uid: string;
}) {
  const { req, roomCode, gw, seasonKey, uid } = opts;
  const roomRef = adminDb.doc(`rooms/${roomCode}`);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) throw new Error("Room not found");

  const room = roomSnap.data() as RoomDoc;
  if ((room.settings?.gameModeStyle ?? "round_robin") !== "league") {
    throw new Error("This room is not in League mode");
  }

  const playerSnap = await adminDb
    .doc(`rooms/${roomCode}/players/${uid}`)
    .get();
  if (!playerSnap.exists) throw new Error("You are not in this room");

  const roomPlayersSnap = await adminDb
    .collection(`rooms/${roomCode}/players`)
    .get();
  const roomPlayers = roomPlayersSnap.docs.map((d) => d.id);
  if (roomPlayers.length < 2) {
    throw new Error("Need at least 2 room players to open League predictions");
  }

  const loaded = await loadGwFixturesWithLockWindow(
    getBaseUrl(req),
    gw,
    seasonKey,
    { lockMode: "league" },
  );
  if (Date.now() >= loaded.lockAt.getTime()) {
    throw new Error(
      "League predictions lock 30 minutes before the first game of the gameweek.",
    );
  }
  if (!loaded.fixtureIds.length) {
    throw new Error(
      "No eligible fixtures for this GW (played/postponed/cancelled).",
    );
  }

  const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;
  const gameRef = adminDb.doc(`${seasonBase}/games/gw-${gw}`);
  const leagueFairPlayEnabled = room.settings?.leagueFairPlayEnabled === true;

  await adminDb.runTransaction(async (tx) => {
    const existing = await tx.get(gameRef);
    if (existing.exists) {
      const game = (existing.data() as GameDoc | undefined) ?? {};
      const state = String(game.state || "")
        .trim()
        .toUpperCase();
      if (
        game.gameModeStyle === "league" &&
        (state === "DRAFT" || state === "LOBBY" || state === "CLOSED")
      ) {
        const mergedPlayers = uniqueIds([
          ...(Array.isArray(game.players) ? game.players : []),
          ...roomPlayers,
        ]);
        const mergedOrder = uniqueIds([
          ...(Array.isArray(game.order) ? game.order : []),
          ...mergedPlayers,
        ]);
        tx.set(
          gameRef,
          {
            state: "DRAFT",
            players: mergedPlayers,
            order: mergedOrder,
            firstKickoffAt: loaded.firstKickoffAt,
            lockAt: loaded.lockAt,
            leagueFairPlayEnabled,
            seasonKey,
          },
          { merge: true },
        );
        return;
      }
      if (state && state !== "LOBBY") throw new Error("Game already started");
    }

    const order = shuffle(roomPlayers);
    tx.set(
      gameRef,
      {
        state: "DRAFT",
        leaderUid: room.leaderUid || uid,
        players: roomPlayers,
        order,
        fixtureIds: loaded.fixtureIds,
        currentFixtureId: null,
        currentTurn: 0,
        totalTurns: order.length * loaded.fixtureIds.length,
        draftMode: "parallel",
        sameResultLock: false,
        powerupsEnabled: false,
        gameModeStyle: "league",
        leagueFairPlayEnabled,
        leagueSubmittedByUid: {},
        voidedFixtureIds: [],
        draftReadyByUid: {},
        firstKickoffAt: loaded.firstKickoffAt,
        lockAt: loaded.lockAt,
        seasonKey,
        createdAt: new Date(),
        startedAt: new Date(),
      },
      { merge: true },
    );
  });

  return {
    ok: true as const,
    lockAt: loaded.lockAt,
    firstKickoffAt: loaded.firstKickoffAt,
  };
}
