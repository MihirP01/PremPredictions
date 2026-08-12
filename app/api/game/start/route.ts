export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { getBaseUrl, loadGwFixturesWithLockWindow } from "../lock-window";
import { resolveSeasonKey } from "../../season";

type StartBody = {
  roomCode?: string;
  gw?: number;
  leaderUid?: string;
  seasonKey?: string;
};

type RoomDoc = {
  leaderUid?: string;
  settings?: {
    sameResultLock?: boolean;
    powerupsEnabled?: boolean;
    leagueFairPlayEnabled?: boolean;
    gameModeStyle?: "round_robin" | "sprint" | "captain" | "league";
  };
};

type GameDoc = { state?: string };

function onlyAlnum(s: string) {
  return /^[A-Z0-9]{4,8}$/.test(s);
}

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StartBody;
    const roomCode = String(body.roomCode || "").toUpperCase();
    const gw = Number(body.gw);
    const leaderUid = String(body.leaderUid || "");
    const seasonKey = resolveSeasonKey(body.seasonKey);

    if (!onlyAlnum(roomCode))
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    if (!Number.isFinite(gw) || gw < 1 || gw > 38)
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    if (!leaderUid)
      return NextResponse.json({ error: "Missing leaderUid" }, { status: 400 });

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists)
      return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const room = roomSnap.data() as RoomDoc;
    if (room.leaderUid !== leaderUid)
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    const style: "round_robin" | "sprint" | "captain" | "league" =
      room.settings?.gameModeStyle ?? "round_robin";
    const sameResultLock =
      style === "sprint" || style === "league"
        ? false
        : room.settings?.sameResultLock !== false;
    const draftMode: "turn" | "parallel" =
      style === "sprint" ||
      style === "league" ||
      (style === "captain" && !sameResultLock)
        ? "parallel"
        : "turn";
    const powerupsEnabled =
      style !== "league" && room.settings?.powerupsEnabled === true;
    const leagueFairPlayEnabled =
      style === "league" && room.settings?.leagueFairPlayEnabled === true;

    const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;

    // League is asynchronous, so its roster is every room member. The live
    // modes continue to use the players who are present in the lobby.
    const roomPlayersSnap = await adminDb
      .collection(`rooms/${roomCode}/players`)
      .get();
    const roomPlayers = roomPlayersSnap.docs.map((d) => d.id);
    const lobbySnap = await adminDb
      .collection(`${seasonBase}/games/gw-${gw}/lobby`)
      .get();
    const lobbyPlayers = lobbySnap.docs.map((d) => d.id);
    const players = style === "league" ? roomPlayers : lobbyPlayers;

    if (players.length < 2)
      return NextResponse.json(
        {
          error:
            style === "league"
              ? "Need at least 2 room players to open League predictions"
              : "Need at least 2 players in lobby",
        },
        { status: 400 },
      );

    // Live modes still require every current room member to be present.
    const lobbySet = new Set(players);
    const allMembersPresent =
      roomPlayers.length > 0 &&
      roomPlayers.every((uid) => lobbySet.has(uid)) &&
      players.length === roomPlayers.length;

    if (roomPlayers.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 room players to start" },
        { status: 400 },
      );
    }

    if (style !== "league" && !allMembersPresent) {
      return NextResponse.json(
        {
          error: `All room players must join lobby before starting (${players.length}/${roomPlayers.length})`,
        },
        { status: 400 },
      );
    }

    const base = getBaseUrl(req);
    let fixtureIds: number[] = [];
    let firstKickoffAt: Date;
    let lockAt: Date;
    try {
      const loaded = await loadGwFixturesWithLockWindow(base, gw, seasonKey);
      fixtureIds = loaded.fixtureIds;
      firstKickoffAt = loaded.firstKickoffAt;
      lockAt = loaded.lockAt;
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to load fixtures";
      const status =
        message.startsWith("No fixtures") ||
        message.startsWith("No eligible fixtures") ||
        message.startsWith("Fixtures missing kickoff")
          ? 400
          : 502;
      return NextResponse.json({ error: message }, { status });
    }

    if (Date.now() >= lockAt.getTime()) {
      return NextResponse.json(
        {
          error:
            "Mini-game is locked (deadline is 30 minutes before first kickoff).",
        },
        { status: 409 },
      );
    }

    // Live rounds retain their ten-fixture shape. League includes every
    // eligible fixture assigned to the requested gameweek (including DGWs).
    const gameFixtureIds =
      style === "league" ? fixtureIds : fixtureIds.slice(0, 10);

    // Choose first player randomly each week, then rotate through order
    const order = shuffle(players);

    const gameRef = adminDb.doc(`${seasonBase}/games/gw-${gw}`);

    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(gameRef);
      if (existing.exists) {
        const st = (existing.data() as GameDoc | undefined)?.state;
        if (st && st !== "LOBBY") throw new Error("Game already started");
      }

      tx.set(
        gameRef,
        {
          state: "DRAFT",
          leaderUid,
          players,
          order,
          fixtureIds: gameFixtureIds,
          currentFixtureId: null,
          currentTurn: 0,
          totalTurns: order.length * gameFixtureIds.length,
          draftMode,
          sameResultLock,
          powerupsEnabled,
          gameModeStyle: style,
          leagueFairPlayEnabled,
          leagueSubmittedByUid: {},
          voidedFixtureIds: [],
          draftReadyByUid: {},
          firstKickoffAt,
          lockAt,
          seasonKey,
          createdAt: new Date(),
          startedAt: new Date(),
        },
        { merge: true },
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "start failed" },
      { status: 500 },
    );
  }
}
