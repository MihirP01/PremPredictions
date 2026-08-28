#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import pg from "pg";

const { Pool } = pg;
const ARCHIVE_BATCH_SIZE = 200;
const DETACHED_COLLECTION_GROUPS = [
  "players",
  "private",
  "seasons",
  "games",
  "lobby",
  "picks",
  "golden",
  "powerups",
  "scores",
  "users",
  "yearTable",
];
const visitedPaths = new Set();

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
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
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function normalizePrivateKey(key) {
  return key
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();
}

function jsonSafe(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (typeof value.path === "string") return { __reference: value.path };
    if (
      typeof value.latitude === "number" &&
      typeof value.longitude === "number"
    ) {
      return { latitude: value.latitude, longitude: value.longitude };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]),
    );
  }
  return value;
}

function parseGameweek(value) {
  const match = String(value || "").match(/^(?:gw-)?(\d{1,2})$/i);
  const gameweek = match ? Number(match[1]) : NaN;
  return Number.isInteger(gameweek) && gameweek >= 1 && gameweek <= 38
    ? gameweek
    : null;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

loadEnvLocal();

const firebaseApp =
  getApps()[0] ||
  initializeApp({
    credential: cert({
      projectId: must("FIREBASE_PROJECT_ID"),
      clientEmail: must("FIREBASE_CLIENT_EMAIL"),
      privateKey: normalizePrivateKey(must("FIREBASE_PRIVATE_KEY")),
    }),
  });
const firestore = getFirestore(firebaseApp);
const pool = new Pool({
  connectionString: must("DATABASE_URL"),
  max: 4,
  application_name: "prem-predictions-firestore-backfill",
});

const counts = new Map();
const archiveBuffer = [];

async function flushArchive(client) {
  if (!archiveBuffer.length) return;
  const rows = archiveBuffer.splice(0, archiveBuffer.length);
  const values = [];
  const placeholders = rows.map((row, index) => {
    const offset = index * 5;
    values.push(
      row.path,
      row.collectionGroup,
      row.documentId,
      JSON.stringify(row.data),
      row.sourceUpdateTime,
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb, $${offset + 5})`;
  });
  await client.query(
    `INSERT INTO firestore_documents
      (path, collection_group, document_id, data, source_update_time)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (path) DO UPDATE SET
       collection_group = EXCLUDED.collection_group,
       document_id = EXCLUDED.document_id,
       data = EXCLUDED.data,
       source_update_time = EXCLUDED.source_update_time,
       migrated_at = now()`,
    values,
  );
}

async function ensureUser(client, uid, data = {}) {
  if (!uid) return;
  await client.query(
    `INSERT INTO app_users
      (firebase_uid, email, display_name, current_room_code, source_data, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (firebase_uid) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, app_users.email),
       display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
       current_room_code = COALESCE(EXCLUDED.current_room_code, app_users.current_room_code),
       source_data = CASE WHEN EXCLUDED.source_data = '{}'::jsonb THEN app_users.source_data ELSE EXCLUDED.source_data END,
       updated_at = now()`,
    [
      uid,
      data.email || null,
      data.displayName || null,
      data.currentRoomCode || null,
      JSON.stringify(data),
    ],
  );
}

async function upsertKnownDocument(client, documentPath, documentId, data) {
  const parts = documentPath.split("/");

  if (parts[0] === "users" && parts.length === 2) {
    await ensureUser(client, documentId, data);
    return;
  }

  if (parts[0] !== "rooms" || parts.length < 2) return;
  const roomCode = parts[1].toUpperCase();

  if (parts.length === 2) {
    const settings =
      data.settings && typeof data.settings === "object" ? data.settings : {};
    const leaderUid = String(data.leaderUid || "unknown");
    await ensureUser(client, leaderUid);
    await client.query(
      `INSERT INTO rooms
        (code, leader_uid, game_mode_style, same_result_lock, powerups_enabled,
         league_fair_play_enabled, theme_accent, has_password, settings,
         source_data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,COALESCE($11,now()),now())
       ON CONFLICT (code) DO UPDATE SET
         leader_uid = EXCLUDED.leader_uid,
         game_mode_style = EXCLUDED.game_mode_style,
         same_result_lock = EXCLUDED.same_result_lock,
         powerups_enabled = EXCLUDED.powerups_enabled,
         league_fair_play_enabled = EXCLUDED.league_fair_play_enabled,
         theme_accent = EXCLUDED.theme_accent,
         has_password = EXCLUDED.has_password,
         settings = EXCLUDED.settings,
         source_data = EXCLUDED.source_data,
         updated_at = now()`,
      [
        roomCode,
        leaderUid,
        settings.gameModeStyle || "sprint",
        settings.sameResultLock === true,
        settings.powerupsEnabled === true,
        settings.leagueFairPlayEnabled === true,
        settings.themeAccent || "teal",
        settings.hasPassword === true,
        JSON.stringify(settings),
        JSON.stringify(data),
        asDate(data.createdAt),
      ],
    );
    return;
  }

  if (parts[2] === "players" && parts.length === 4) {
    const uid = documentId;
    await ensureUser(client, uid, {
      displayName: data.displayName,
      currentRoomCode: roomCode,
    });
    await client.query(
      `INSERT INTO room_members
        (room_code, user_id, role, display_name, nickname, source_data, joined_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,COALESCE($7,now()),now())
       ON CONFLICT (room_code, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         display_name = EXCLUDED.display_name,
         nickname = EXCLUDED.nickname,
         source_data = EXCLUDED.source_data,
         updated_at = now()`,
      [
        roomCode,
        uid,
        data.role === "leader" ? "leader" : "member",
        data.displayName || null,
        data.nickName || null,
        JSON.stringify(data),
        asDate(data.joinedAt),
      ],
    );
    return;
  }

  if (parts[2] === "private" && parts[3] === "security" && parts.length === 4) {
    if (!data.passwordHash || !data.passwordSalt) return;
    await client.query(
      `INSERT INTO room_security
        (room_code, password_hash, password_salt, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,now()))
       ON CONFLICT (room_code) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         password_salt = EXCLUDED.password_salt,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [
        roomCode,
        data.passwordHash,
        data.passwordSalt,
        data.updatedBy || null,
        asDate(data.updatedAt),
      ],
    );
    return;
  }

  if (parts[2] !== "seasons" || parts.length < 4) return;
  const seasonKey = parts[3];
  if (parts.length === 4) {
    await client.query(
      `INSERT INTO seasons (room_code, season_key, source_data, updated_at)
       VALUES ($1,$2,$3::jsonb,now())
       ON CONFLICT (room_code, season_key) DO UPDATE SET
         source_data = EXCLUDED.source_data,
         updated_at = now()`,
      [roomCode, seasonKey, JSON.stringify(data)],
    );
    return;
  }

  const gameweek = parseGameweek(parts[5]);
  if (parts[4] === "games" && gameweek != null) {
    if (parts.length === 6) {
      await client.query(
        `INSERT INTO games
          (room_code, season_key, gameweek, state, game_mode_style, leader_uid, fixture_ids, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,now())
         ON CONFLICT (room_code, season_key, gameweek) DO UPDATE SET
           state = EXCLUDED.state,
           game_mode_style = EXCLUDED.game_mode_style,
           leader_uid = EXCLUDED.leader_uid,
           fixture_ids = EXCLUDED.fixture_ids,
           data = EXCLUDED.data,
           updated_at = now()`,
        [
          roomCode,
          seasonKey,
          gameweek,
          data.state || "LOBBY",
          data.gameModeStyle || null,
          data.leaderUid || null,
          JSON.stringify(Array.isArray(data.fixtureIds) ? data.fixtureIds : []),
          JSON.stringify(data),
        ],
      );
      return;
    }

    const group = parts[6];
    if (parts.length !== 8) return;
    const uid = String(data.uid || documentId.split("_")[0] || documentId);
    await ensureUser(client, uid);
    if (group === "lobby") {
      await client.query(
        `INSERT INTO game_lobby
          (room_code, season_key, gameweek, user_id, ready, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
         ON CONFLICT (room_code, season_key, gameweek, user_id) DO UPDATE SET
           ready = EXCLUDED.ready, data = EXCLUDED.data, updated_at = now()`,
        [
          roomCode,
          seasonKey,
          gameweek,
          uid,
          data.ready === true,
          JSON.stringify(data),
        ],
      );
    } else if (group === "picks" && Number.isFinite(Number(data.fixtureId))) {
      await client.query(
        `INSERT INTO predictions
          (room_code, season_key, gameweek, user_id, fixture_id, score, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
         ON CONFLICT (room_code, season_key, gameweek, user_id, fixture_id) DO UPDATE SET
           score = EXCLUDED.score, data = EXCLUDED.data, updated_at = now()`,
        [
          roomCode,
          seasonKey,
          gameweek,
          uid,
          Number(data.fixtureId),
          data.score || null,
          JSON.stringify(data),
        ],
      );
    } else if (group === "golden") {
      await client.query(
        `INSERT INTO golden_picks
          (room_code, season_key, gameweek, user_id, fixture_id, score, locked, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
         ON CONFLICT (room_code, season_key, gameweek, user_id) DO UPDATE SET
           fixture_id = EXCLUDED.fixture_id, score = EXCLUDED.score,
           locked = EXCLUDED.locked, data = EXCLUDED.data, updated_at = now()`,
        [
          roomCode,
          seasonKey,
          gameweek,
          uid,
          data.fixtureId || null,
          data.score || null,
          data.locked === true,
          JSON.stringify(data),
        ],
      );
    } else if (group === "powerups") {
      await client.query(
        `INSERT INTO powerups
          (room_code, season_key, gameweek, user_id, fixture_id, powerup_type, locked, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
         ON CONFLICT (room_code, season_key, gameweek, user_id) DO UPDATE SET
           fixture_id = EXCLUDED.fixture_id, powerup_type = EXCLUDED.powerup_type,
           locked = EXCLUDED.locked, data = EXCLUDED.data, updated_at = now()`,
        [
          roomCode,
          seasonKey,
          gameweek,
          uid,
          data.fixtureId || null,
          data.powerupType || null,
          data.locked === true,
          JSON.stringify(data),
        ],
      );
    }
    return;
  }

  if (
    parts[4] === "scores" &&
    gameweek != null &&
    parts[6] === "users" &&
    parts.length === 8
  ) {
    const uid = String(data.uid || documentId);
    await ensureUser(client, uid);
    await client.query(
      `INSERT INTO weekly_scores
        (room_code, season_key, gameweek, user_id, points, fair_play_bye, data, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
       ON CONFLICT (room_code, season_key, gameweek, user_id) DO UPDATE SET
         points = EXCLUDED.points,
         fair_play_bye = EXCLUDED.fair_play_bye,
         data = EXCLUDED.data,
         updated_at = now()`,
      [
        roomCode,
        seasonKey,
        gameweek,
        uid,
        Number(data.points || 0),
        data.fairPlayApplied === true,
        JSON.stringify(data),
      ],
    );
    return;
  }

  if (
    parts[4] === "yearTable" &&
    parts[5] === "meta" &&
    parts[6] === "picks" &&
    parts.length === 8
  ) {
    const uid = String(data.uid || documentId);
    await ensureUser(client, uid);
    const order = Array.isArray(data.order) ? data.order.map(String) : [];
    await client.query(
      `INSERT INTO year_table_picks
        (room_code, season_key, user_id, club_order, data, submitted_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,now())
       ON CONFLICT (room_code, season_key, user_id) DO UPDATE SET
         club_order = EXCLUDED.club_order,
         data = EXCLUDED.data,
         submitted_at = EXCLUDED.submitted_at,
         updated_at = now()`,
      [
        roomCode,
        seasonKey,
        uid,
        JSON.stringify(order),
        JSON.stringify(data),
        asDate(data.submittedAt),
      ],
    );
    await client.query(
      `INSERT INTO user_year_table_picks
        (season_key, user_id, club_order, data, submitted_at, updated_at)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,now())
       ON CONFLICT (season_key, user_id) DO UPDATE SET
         club_order = EXCLUDED.club_order,
         data = EXCLUDED.data,
         submitted_at = COALESCE(user_year_table_picks.submitted_at, EXCLUDED.submitted_at),
         updated_at = now()
       WHERE jsonb_typeof(EXCLUDED.club_order) = 'array'
         AND jsonb_array_length(EXCLUDED.club_order) = 20`,
      [
        seasonKey,
        uid,
        JSON.stringify(order),
        JSON.stringify(data),
        asDate(data.submittedAt),
      ],
    );
  }
}

async function migrateDocument(client, document) {
  if (visitedPaths.has(document.ref.path)) return;
  visitedPaths.add(document.ref.path);
  const data = jsonSafe(document.data());
  const collectionGroup = document.ref.parent.id;
  counts.set(collectionGroup, (counts.get(collectionGroup) || 0) + 1);
  archiveBuffer.push({
    path: document.ref.path,
    collectionGroup,
    documentId: document.id,
    data,
    sourceUpdateTime: document.updateTime?.toDate() || null,
  });
  await upsertKnownDocument(client, document.ref.path, document.id, data);
  if (archiveBuffer.length >= ARCHIVE_BATCH_SIZE) await flushArchive(client);

  const subcollections = await document.ref.listCollections();
  for (const subcollection of subcollections) {
    await walkCollection(client, subcollection);
  }
}

async function walkCollection(client, collectionRef) {
  const snapshot = await collectionRef.get();
  for (const document of snapshot.docs) {
    await migrateDocument(client, document);
  }
}

async function discoverDetachedDocuments(client) {
  console.log("Discovering detached Firestore subcollections...");
  for (const collectionGroup of DETACHED_COLLECTION_GROUPS) {
    const snapshot = await firestore.collectionGroup(collectionGroup).get();
    for (const document of snapshot.docs) {
      await migrateDocument(client, document);
    }
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1 FROM firestore_documents LIMIT 1");
    const rootCollections = await firestore.listCollections();
    for (const collection of rootCollections) {
      console.log(`Migrating ${collection.id}...`);
      await walkCollection(client, collection);
    }
    await discoverDetachedDocuments(client);
    await flushArchive(client);
    console.log("Firestore to PostgreSQL backfill complete.");
    console.table(
      [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([collection, documents]) => ({ collection, documents })),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
