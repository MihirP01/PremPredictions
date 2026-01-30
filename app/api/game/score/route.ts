export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

function outcome(h: number, a: number) {
  if (h > a) return "H";
  if (h < a) return "A";
  return "D";
}

function parseScore(s: string | null | undefined) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { h: Number(m[1]), a: Number(m[2]) };
}

function basePoints(pred: string, actual: string) {
  const p = parseScore(pred);
  const r = parseScore(actual);
  if (!p || !r) return 0;

  if (p.h === r.h && p.a === r.a) return 2; // exact
  if (outcome(p.h, p.a) === outcome(r.h, r.a)) return 1; // correct result
  return 0;
}

// POST { roomCode, gw }
export async function POST(req: Request) {
  try {
    const { roomCode, gw } = await req.json();
    const rc = String(roomCode || "").toUpperCase();
    const gwn = Number(gw);

    if (!rc) return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    if (!Number.isFinite(gwn) || gwn < 1 || gwn > 38)
      return NextResponse.json({ error: "Bad gw" }, { status: 400 });

    const gameRef = adminDb.doc(`rooms/${rc}/games/gw-${gwn}`);
    const gameSnap = await gameRef.get();
    if (!gameSnap.exists) return NextResponse.json({ error: "Game not found" }, { status: 404 });

    const game = gameSnap.data() as any;
    const players: string[] = Array.isArray(game.players) ? game.players : [];
    const fixtureIds: number[] = Array.isArray(game.fixtureIds) ? game.fixtureIds : [];
    if (players.length === 0 || fixtureIds.length === 0)
      return NextResponse.json({ error: "Missing players/fixtures" }, { status: 400 });

    // Get fixtures + results from your internal API
    const host = req.headers.get("host");
    const proto = host?.includes("localhost") ? "http" : "https";
    const base = host ? `${proto}://${host}` : "http://localhost:3000";

    const fxRes = await fetch(`${base}/api/fixtures?gameweek=${gwn}`, { cache: "no-store" });
    if (!fxRes.ok) return NextResponse.json({ error: "Failed to load fixtures" }, { status: 502 });

    const fxData = await fxRes.json();
    const fixtures: any[] = Array.isArray(fxData.fixtures) ? fxData.fixtures : [];

    // Build actual results map fixtureId -> "x-y" (only if finished)
    const actualByFixture = new Map<number, string>();
    for (const f of fixtures) {
      const id = Number(f.fixtureId);
      if (!Number.isFinite(id)) continue;
      if (f.result) actualByFixture.set(id, String(f.result));
    }

    // If no results yet, nothing to score
    if (actualByFixture.size === 0) {
      return NextResponse.json({ ok: true, scored: 0, message: "No finished results yet." });
    }

    // Read all picks docs for this GW
    const picksSnap = await adminDb.collection(`rooms/${rc}/games/gw-${gwn}/picks`).get();
    const picks = picksSnap.docs.map((d) => d.data() as any);

    // Map uid|fixtureId -> score
    const pickMap = new Map<string, string>();
    for (const p of picks) {
      const uid = String(p.uid || "");
      const fid = Number(p.fixtureId);
      const sc = String(p.score || "").trim();
      if (!uid || !Number.isFinite(fid) || !sc) continue;
      pickMap.set(`${uid}|${fid}`, sc);
    }

    // Read golden docs (doc id is uid)
    const goldenSnap = await adminDb.collection(`rooms/${rc}/games/gw-${gwn}/golden`).get();
    const goldenByUid = new Map<string, { fixtureId: number; locked: boolean }>();
    for (const d of goldenSnap.docs) {
      const data = d.data() as any;
      const uid = d.id;
      goldenByUid.set(uid, { fixtureId: Number(data.fixtureId), locked: !!data.locked });
    }

    // Compute + write scores per user (only for fixtures that have actual results)
    const batch = adminDb.batch();

    let scoredUsers = 0;

    for (const uid of players) {
      let total = 0;
      const breakdown: Record<string, any> = {};

      const g = goldenByUid.get(uid);
      const goldenFixtureId = g?.locked ? g.fixtureId : null;

      for (const fid of fixtureIds) {
        const actual = actualByFixture.get(fid);
        if (!actual) continue; // fixture not finished yet

        const pred = pickMap.get(`${uid}|${fid}`) || "";
        const base = pred ? basePoints(pred, actual) : 0;
        const isGolden = goldenFixtureId === fid;

        const mult = isGolden ? 2 : 1;
        const pts = base * mult;

        total += pts;
        breakdown[String(fid)] = {
          pred: pred || null,
          actual,
          base,
          golden: isGolden,
          total: pts,
        };
      }

      const scoreRef = adminDb.doc(`rooms/${rc}/scores/gw-${gwn}/users/${uid}`);
      batch.set(
        scoreRef,
        {
          uid,
          gw: gwn,
          points: total,
          breakdown,
          computedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      scoredUsers++;
    }

    await batch.commit();

    return NextResponse.json({ ok: true, scored: scoredUsers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "score failed" }, { status: 500 });
  }
}