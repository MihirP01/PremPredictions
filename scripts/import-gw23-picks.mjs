#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|club)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TEAM_ALIASES = {
  "west ham": ["west ham", "west ham united"],
  sunderland: ["sunderland", "sunderland afc"],
  burnley: ["burnley"],
  spurs: ["spurs", "tottenham", "tottenham hotspur"],
  fulham: ["fulham"],
  brighton: ["brighton", "brighton hove albion", "brighton and hove albion"],
  city: ["city", "man city", "manchester city"],
  wolves: ["wolves", "wolverhampton", "wolverhampton wanderers"],
  bournemouth: ["bournemouth", "afc bournemouth"],
  liverpool: ["liverpool"],
  brentford: ["brentford"],
  forrest: ["forrest", "forest", "nottingham forest"],
  palace: ["palace", "crystal palace"],
  chelsea: ["chelsea"],
  newcastle: ["newcastle", "newcastle united"],
  villa: ["villa", "aston villa"],
  arsenal: ["arsenal"],
  united: ["united", "man united", "manchester united"],
  everton: ["everton"],
  leeds: ["leeds", "leeds united"],
};

const ROWS = [
  {
    fixture: "West Ham vs Sunderland",
    Sam: "1-2",
    Mihir: "2-2",
    Khushal: "1-1",
  },
  { fixture: "Burnley vs Spurs", Sam: "0-1", Mihir: "1-2", Khushal: "1-3" },
  { fixture: "Fulham vs Brighton", Sam: "1-1", Mihir: "2-0", Khushal: "2-1" },
  { fixture: "City vs Wolves", Sam: "3-1*", Mihir: "4-0", Khushal: "4-1" },
  {
    fixture: "Bournemouth vs Liverpool",
    Sam: "1-3",
    Mihir: "3-3",
    Khushal: "2-2",
  },
  { fixture: "Brentford vs Forrest", Sam: "3-2", Mihir: "1-2", Khushal: "2-1" },
  { fixture: "Palace vs Chelsea", Sam: "1-2", Mihir: "1-3", Khushal: "1-3" },
  { fixture: "Newcastle vs Villa", Sam: "2-1", Mihir: "1-3", Khushal: "2-2" },
  { fixture: "Arsenal vs United", Sam: "2-2", Mihir: "1-3*", Khushal: "2-1*" },
  { fixture: "Everton vs Leeds", Sam: "2-1", Mihir: "2-2", Khushal: "1-1" },
];

const PLAYER_ORDER = ["Sam", "Mihir", "Khushal"];

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

function parseScoreCell(raw) {
  const trimmed = String(raw || "").trim();
  const golden = trimmed.endsWith("*");
  const score = trimmed.replace(/\*/g, "").trim();
  if (!/^\d+\s*-\s*\d+$/.test(score)) {
    throw new Error(`Invalid score cell: '${raw}'`);
  }
  return {
    score: score.replace(/\s*/g, ""),
    golden,
  };
}

function teamCandidateList(label) {
  const key = normalize(label);
  const aliases = TEAM_ALIASES[key] || [label];
  return aliases.map(normalize);
}

function teamMatches(teamName, desiredLabel) {
  const team = normalize(teamName);
  const candidates = teamCandidateList(desiredLabel);
  return candidates.some(
    (candidate) =>
      team === candidate ||
      team.includes(candidate) ||
      candidate.includes(team),
  );
}

function pickFixture(fixtures, fixtureLabel) {
  const [homeRaw, awayRaw] = String(fixtureLabel)
    .split(/\s+vs\s+/i)
    .map((s) => s.trim());
  if (!homeRaw || !awayRaw)
    throw new Error(`Bad fixture label '${fixtureLabel}'`);

  const match = fixtures.find(
    (f) =>
      teamMatches(f.homeTeam?.name || "", homeRaw) &&
      teamMatches(f.awayTeam?.name || "", awayRaw),
  );

  if (!match) {
    throw new Error(`Could not match fixture '${fixtureLabel}' in API list`);
  }
  return match;
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

async function fetchFixtures(gw, seasonKey) {
  const apiKey = must("FOOTBALLDATA_KEY");
  const season = 2000 + Number(String(seasonKey).slice(0, 2));
  const url = `https://api.football-data.org/v4/competitions/PL/matches?season=${season}&matchday=${gw}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fixture API failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return Array.isArray(data?.matches) ? data.matches : [];
}

async function resolvePlayers(roomCode) {
  const snap = await db.collection(`rooms/${roomCode}/players`).get();
  const byLabel = new Map();

  for (const d of snap.docs) {
    const data = d.data() || {};
    const names = [data.nickName, data.displayName]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    for (const n of names) {
      byLabel.set(normalize(n), d.id);
    }
  }

  const resolved = {};
  for (const p of PLAYER_ORDER) {
    const uid = byLabel.get(normalize(p));
    if (!uid)
      throw new Error(`Could not resolve player '${p}' in room ${roomCode}`);
    resolved[p] = uid;
  }
  return resolved;
}

async function run() {
  const { roomCode, seasonKey, gw, apply } = opts;
  console.log(
    `Importing historical picks: room=${roomCode} season=${seasonKey} gw=${gw} apply=${apply}`,
  );

  const [fixtures, playersByName] = await Promise.all([
    fetchFixtures(gw, seasonKey),
    resolvePlayers(roomCode),
  ]);

  const picks = [];
  const goldenByUid = new Map();

  for (const row of ROWS) {
    const fixture = pickFixture(fixtures, row.fixture);
    for (const p of PLAYER_ORDER) {
      const uid = playersByName[p];
      const cell = parseScoreCell(row[p]);
      picks.push({
        uid,
        fixtureId: Number(fixture.id),
        score: cell.score,
        fixtureLabel: row.fixture,
      });
      if (cell.golden) {
        goldenByUid.set(uid, {
          uid,
          fixtureId: Number(fixture.id),
          score: cell.score,
        });
      }
    }
  }

  if (goldenByUid.size !== PLAYER_ORDER.length) {
    console.warn(
      `Warning: expected ${PLAYER_ORDER.length} golden picks, found ${goldenByUid.size}`,
    );
  }

  console.log("Resolved players:", playersByName);
  console.log(
    `Matched fixtures: ${new Set(picks.map((p) => p.fixtureId)).size}`,
  );
  console.log(`Picks to write: ${picks.length}`);
  console.log(`Golden docs to write: ${goldenByUid.size}`);

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to write to Firestore.");
    return;
  }

  const gamePath = `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${gw}`;
  const fixtureIds = [...new Set(picks.map((p) => p.fixtureId))];
  const order = PLAYER_ORDER.map((p) => playersByName[p]);
  const batch = db.batch();

  // Ensure game doc exists for this historical GW.
  batch.set(
    db.doc(gamePath),
    {
      state: "REVEAL",
      players: order,
      order,
      fixtureIds,
      currentTurn: fixtureIds.length * order.length,
      totalTurns: fixtureIds.length * order.length,
      importedAt: new Date(),
      importedBy: "scripts/import-gw23-picks.mjs",
    },
    { merge: true },
  );

  for (const p of picks) {
    const pickId = `${p.uid}_${p.fixtureId}`;
    batch.set(
      db.doc(`${gamePath}/picks/${pickId}`),
      {
        uid: p.uid,
        fixtureId: p.fixtureId,
        score: p.score,
        createdAt: new Date(),
        importedAt: new Date(),
        importedBy: "scripts/import-gw23-picks.mjs",
      },
      { merge: true },
    );
  }

  for (const g of goldenByUid.values()) {
    batch.set(
      db.doc(`${gamePath}/golden/${g.uid}`),
      {
        uid: g.uid,
        fixtureId: g.fixtureId,
        score: g.score,
        locked: true,
        createdAt: new Date(),
        importedAt: new Date(),
        importedBy: "scripts/import-gw23-picks.mjs",
      },
      { merge: true },
    );
  }

  await batch.commit();
  console.log("Import complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
