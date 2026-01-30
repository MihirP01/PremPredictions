export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";

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
    const body = await req.json();
    const roomCode = String(body.roomCode || "").toUpperCase();
    const gw = Number(body.gw);
    const leaderUid = String(body.leaderUid || "");

    if (!onlyAlnum(roomCode)) return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    if (!Number.isFinite(gw) || gw < 1 || gw > 38) return NextResponse.json({ error: "Bad gw" }, { status: 400 });
    if (!leaderUid) return NextResponse.json({ error: "Missing leaderUid" }, { status: 400 });

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const room = roomSnap.data() as any;
    if (room.leaderUid !== leaderUid) return NextResponse.json({ error: "Not leader" }, { status: 403 });

    // roster = current lobby users (ONLY those in minigame lobby)
    const lobbySnap = await adminDb.collection(`rooms/${roomCode}/games/gw-${gw}/lobby`).get();
    const players = lobbySnap.docs.map(d => d.id);

    if (players.length < 2) return NextResponse.json({ error: "Need at least 2 players in lobby" }, { status: 400 });

    // get fixtures from your own internal API (server-side fetch)
    const host = req.headers.get("host");
const proto = host?.includes("localhost") ? "http" : "https";
const base = host ? `${proto}://${host}` : "http://localhost:3000";

    const fxRes = await fetch(`${base}/api/fixtures?gameweek=${gw}`, { cache: "no-store" });
    if (!fxRes.ok) return NextResponse.json({ error: "Failed to load fixtures" }, { status: 502 });

    const fxData = await fxRes.json();
    const fixtureIds: number[] = (fxData.fixtures || []).map((f: any) => Number(f.fixtureId)).filter((n: any) => Number.isFinite(n));

    if (fixtureIds.length === 0) return NextResponse.json({ error: "No fixtures for this GW" }, { status: 400 });

    // Ensure exactly 10 if that’s your rule; otherwise allow any length
    const fixtureIds10 = fixtureIds.slice(0, 10);

    // Choose first player randomly each week, then rotate through order
    const order = shuffle(players);

    const gameRef = adminDb.doc(`rooms/${roomCode}/games/gw-${gw}`);

    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(gameRef);
      if (existing.exists) {
        const st = (existing.data() as any)?.state;
        if (st && st !== "LOBBY") throw new Error("Game already started");
      }

      tx.set(gameRef, {
        state: "DRAFT",
        leaderUid,
        players,
        order,
        fixtureIds: fixtureIds10,
        currentTurn: 0,
        totalTurns: order.length * fixtureIds10.length,
        createdAt: new Date(),
        startedAt: new Date(),
      }, { merge: true });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "start failed" }, { status: 500 });
  }
}