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
    const sameResultLock = room.settings?.sameResultLock !== false;
    const draftMode: "turn" | "parallel" = sameResultLock
      ? "turn"
      : "parallel";

    const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;

    // roster = current lobby users (ONLY those in minigame lobby)
    const lobbySnap = await adminDb
      .collection(`${seasonBase}/games/gw-${gw}/lobby`)
      .get();
    const players = lobbySnap.docs.map((d) => d.id);

    if (players.length < 1)
      return NextResponse.json(
        { error: "Need at least 2 players in lobby" },
        { status: 400 },
      );

    // Require every current room member to be present in lobby before starting.
    const roomPlayersSnap = await adminDb
      .collection(`rooms/${roomCode}/players`)
      .get();
    const roomPlayers = roomPlayersSnap.docs.map((d) => d.id);
    const lobbySet = new Set(players);
    const allMembersPresent =
      roomPlayers.length > 0 &&
      roomPlayers.every((uid) => lobbySet.has(uid)) &&
      players.length === roomPlayers.length;

    if (!allMembersPresent) {
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
      const message = e instanceof Error ? e.message : "Failed to load fixtures";
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
            "Mini-game is locked (deadline is 1 hour before first kickoff).",
        },
        { status: 409 },
      );
    }

    // Ensure exactly 10 if that’s your rule; otherwise allow any length.
    const fixtureIds10 = fixtureIds.slice(0, 10);

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
          fixtureIds: fixtureIds10,
          currentTurn: 0,
          totalTurns: order.length * fixtureIds10.length,
          draftMode,
          sameResultLock,
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
