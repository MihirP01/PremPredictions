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

function inferSeasonKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? year : year - 1; // Aug rollover
  return `${String(startYear % 100).padStart(2, "0")}${String((startYear + 1) % 100).padStart(2, "0")}`;
}

async function copySubcollection(sourcePath, targetPath) {
  const sourceSnap = await db.collection(sourcePath).get();
  if (sourceSnap.empty) return 0;

  let copied = 0;
  for (const d of sourceSnap.docs) {
    await db.doc(`${targetPath}/${d.id}`).set(d.data(), { merge: true });
    copied += 1;
  }
  return copied;
}

loadEnvLocal();

const seasonKey = process.argv[2] || inferSeasonKey();

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
  console.log(`Migrating legacy room data into season ${seasonKey}...`);
  const roomsSnap = await db.collection("rooms").get();

  let roomsTouched = 0;
  let gameDocs = 0;
  let scoreDocs = 0;
  let picksDocs = 0;
  let goldenDocs = 0;
  let lobbyDocs = 0;
  let scoreUserDocs = 0;

  for (const roomDoc of roomsSnap.docs) {
    const roomCode = roomDoc.id;
    const legacyGamesSnap = await db
      .collection(`rooms/${roomCode}/games`)
      .get();
    const legacyScoresSnap = await db
      .collection(`rooms/${roomCode}/scores`)
      .get();

    if (legacyGamesSnap.empty && legacyScoresSnap.empty) continue;
    roomsTouched += 1;

    const seasonRoot = db.doc(`rooms/${roomCode}/seasons/${seasonKey}`);
    await seasonRoot.set(
      {
        seasonKey,
        migratedFromLegacyAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    for (const gwDoc of legacyGamesSnap.docs) {
      const gwId = gwDoc.id;
      await db
        .doc(`rooms/${roomCode}/seasons/${seasonKey}/games/${gwId}`)
        .set(gwDoc.data(), { merge: true });
      gameDocs += 1;

      lobbyDocs += await copySubcollection(
        `rooms/${roomCode}/games/${gwId}/lobby`,
        `rooms/${roomCode}/seasons/${seasonKey}/games/${gwId}/lobby`,
      );
      picksDocs += await copySubcollection(
        `rooms/${roomCode}/games/${gwId}/picks`,
        `rooms/${roomCode}/seasons/${seasonKey}/games/${gwId}/picks`,
      );
      goldenDocs += await copySubcollection(
        `rooms/${roomCode}/games/${gwId}/golden`,
        `rooms/${roomCode}/seasons/${seasonKey}/games/${gwId}/golden`,
      );
    }

    for (const gwDoc of legacyScoresSnap.docs) {
      const gwId = gwDoc.id;
      await db
        .doc(`rooms/${roomCode}/seasons/${seasonKey}/scores/${gwId}`)
        .set(gwDoc.data(), { merge: true });
      scoreDocs += 1;

      scoreUserDocs += await copySubcollection(
        `rooms/${roomCode}/scores/${gwId}/users`,
        `rooms/${roomCode}/seasons/${seasonKey}/scores/${gwId}/users`,
      );
    }
  }

  console.log("Migration complete.");
  console.log(
    JSON.stringify(
      {
        seasonKey,
        roomsTouched,
        gameDocs,
        scoreDocs,
        lobbyDocs,
        picksDocs,
        goldenDocs,
        scoreUserDocs,
      },
      null,
      2,
    ),
  );
}

run().catch((err) => {
  console.error("Migration failed:", err?.message || err);
  process.exit(1);
});
