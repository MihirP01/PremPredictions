#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function normalizePrivateKey(key) {
  return key
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    roomCode: "PREM25",
    seasonKey: "2526",
    gw: 23,
    apply: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--room" && args[i + 1])
      opts.roomCode = String(args[++i]).toUpperCase();
    else if (a === "--season" && args[i + 1])
      opts.seasonKey = String(args[++i]);
    else if (a === "--gw" && args[i + 1]) opts.gw = Number(args[++i]);
    else if (a === "--apply") opts.apply = true;
  }
  return opts;
}

function parseScore(s) {
  if (!s) return null;
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { h: Number(m[1]), a: Number(m[2]) };
}

function outcome(h, a) {
  if (h > a) return "H";
  if (h < a) return "A";
  return "D";
}

function basePoints(pred, actual) {
  const p = parseScore(pred);
  const r = parseScore(actual);
  if (!p || !r) return 0;
  if (p.h === r.h && p.a === r.a) return 2;
  if (outcome(p.h, p.a) === outcome(r.h, r.a)) return 1;
  return 0;
}

async function fetchResults(gw, seasonKey) {
  const apiKey = must("FOOTBALLDATA_KEY");
  const season = 2000 + Number(String(seasonKey).slice(0, 2));
  const url = `https://api.football-data.org/v4/competitions/PL/matches?season=${season}&matchday=${gw}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Football API ${res.status}: ${body}`);
  }
  const data = await res.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const map = new Map();
  for (const m of matches) {
    const fid = Number(m?.id);
    const h = m?.score?.fullTime?.home;
    const a = m?.score?.fullTime?.away;
    if (!Number.isFinite(fid)) continue;
    if (m?.status === "FINISHED" && Number.isFinite(h) && Number.isFinite(a)) {
      map.set(fid, `${h}-${a}`);
    }
  }
  return map;
}

loadEnvLocal();
const opts = parseArgs();

const app =
  getApps()[0] ||
  initializeApp({
    credential: cert({
      projectId: must("FIREBASE_PROJECT_ID"),
      clientEmail: must("FIREBASE_CLIENT_EMAIL"),
      privateKey: normalizePrivateKey(must("FIREBASE_PRIVATE_KEY")),
    }),
  });

const db = getFirestore(app);

async function run() {
  const { roomCode, seasonKey, gw, apply } = opts;
  if (!Number.isFinite(gw) || gw < 1 || gw > 38) throw new Error("Bad --gw");

  const gameBase = `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}`;
  const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;

  const gameSnap = await db.doc(gameBase).get();
  if (!gameSnap.exists) throw new Error(`Game doc missing: ${gameBase}`);
  const game = gameSnap.data() || {};
  const players = Array.isArray(game.players) ? game.players : [];
  const fixtureIds = Array.isArray(game.fixtureIds)
    ? game.fixtureIds.map(Number).filter(Number.isFinite)
    : [];

  if (!players.length) throw new Error("No players in game doc");
  if (!fixtureIds.length) throw new Error("No fixtureIds in game doc");

  const actualByFixture = await fetchResults(gw, seasonKey);
  if (!actualByFixture.size) {
    console.log(
      "No finished fixture results yet for this GW; nothing to score.",
    );
    return;
  }

  const picksSnap = await db.collection(`${gameBase}/picks`).get();
  const pickMap = new Map();
  for (const d of picksSnap.docs) {
    const p = d.data() || {};
    const uid = String(p.uid || "");
    const fid = Number(p.fixtureId);
    const score = String(p.score || "").trim();
    if (!uid || !Number.isFinite(fid) || !score) continue;
    pickMap.set(`${uid}|${fid}`, score);
  }

  const goldenSnap = await db.collection(`${gameBase}/golden`).get();
  const goldenByUid = new Map();
  for (const d of goldenSnap.docs) {
    const g = d.data() || {};
    goldenByUid.set(d.id, {
      fixtureId: Number(g.fixtureId),
      locked: Boolean(g.locked),
    });
  }

  const writes = [];
  let scoredUsers = 0;

  for (const uid of players) {
    let total = 0;
    const breakdown = {};
    const g = goldenByUid.get(uid);
    const goldenFixtureId = g?.locked ? g.fixtureId : null;

    for (const fid of fixtureIds) {
      const actual = actualByFixture.get(fid);
      if (!actual) continue;
      const pred = pickMap.get(`${uid}|${fid}`) || "";
      const base = pred ? basePoints(pred, actual) : 0;
      const golden = goldenFixtureId === fid;
      const pts = base * (golden ? 2 : 1);
      total += pts;
      breakdown[String(fid)] = {
        pred: pred || null,
        actual,
        base,
        golden,
        total: pts,
      };
    }

    writes.push({ uid, total, breakdown });
    scoredUsers += 1;
  }

  console.log(`room=${roomCode} season=${seasonKey} gw=${gw}`);
  console.log(
    `players=${players.length} fixturesWithResults=${actualByFixture.size}`,
  );
  console.log(
    "preview:",
    writes.map((w) => ({ uid: w.uid, points: w.total })),
  );

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to write score docs.");
    return;
  }

  const batch = db.batch();
  for (const row of writes) {
    batch.set(
      db.doc(`${seasonBase}/scores/gw-${gw}/users/${row.uid}`),
      {
        uid: row.uid,
        gw,
        points: row.total,
        breakdown: row.breakdown,
        computedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  batch.set(
    db.doc(`${seasonBase}/scores/gw-${gw}`),
    {
      gw,
      roomCode,
      scoredUsers,
      fixturesWithResults: actualByFixture.size,
      computedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
  console.log("Score recalc complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
