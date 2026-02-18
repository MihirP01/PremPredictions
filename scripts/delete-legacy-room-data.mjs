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

async function deleteCollection(path) {
  const snap = await db.collection(path).get();
  if (snap.empty) return 0;
  const chunks = [];
  for (let i = 0; i < snap.docs.length; i += 400) {
    chunks.push(snap.docs.slice(i, i + 400));
  }
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
  }
  return snap.docs.length;
}

loadEnvLocal();

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
  const roomsSnap = await db.collection("rooms").get();
  let deletedGameWeeks = 0;
  let deletedScoreWeeks = 0;
  let deletedPicks = 0;
  let deletedGoldens = 0;
  let deletedLobbies = 0;
  let deletedScoreUsers = 0;

  for (const roomDoc of roomsSnap.docs) {
    const roomCode = roomDoc.id;

    const gamesSnap = await db.collection(`rooms/${roomCode}/games`).get();
    for (const gwDoc of gamesSnap.docs) {
      const base = `rooms/${roomCode}/games/${gwDoc.id}`;
      deletedLobbies += await deleteCollection(`${base}/lobby`);
      deletedPicks += await deleteCollection(`${base}/picks`);
      deletedGoldens += await deleteCollection(`${base}/golden`);
      await gwDoc.ref.delete();
      deletedGameWeeks += 1;
    }

    const scoresSnap = await db.collection(`rooms/${roomCode}/scores`).get();
    for (const gwDoc of scoresSnap.docs) {
      deletedScoreUsers += await deleteCollection(
        `rooms/${roomCode}/scores/${gwDoc.id}/users`,
      );
      await gwDoc.ref.delete();
      deletedScoreWeeks += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        deletedGameWeeks,
        deletedScoreWeeks,
        deletedLobbies,
        deletedPicks,
        deletedGoldens,
        deletedScoreUsers,
      },
      null,
      2,
    ),
  );
}

run().catch((err) => {
  console.error("Legacy delete failed:", err?.message || err);
  process.exit(1);
});
