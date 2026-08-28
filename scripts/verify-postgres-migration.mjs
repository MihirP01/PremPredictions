#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import pg from "pg";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
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

if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
});

async function scalar(sql) {
  const result = await pool.query(sql);
  return Number(result.rows[0]?.count || 0);
}

async function run() {
  const checks = {
    archivedDocuments: await scalar("SELECT count(*) FROM firestore_documents"),
    archivedRooms: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+$'
    `),
    archivedRoomMembers: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/players/[^/]+$'
    `),
    archivedGames: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/games/(gw-)?[0-9]+$'
    `),
    archivedPredictions: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/games/(gw-)?[0-9]+/picks/[^/]+$'
    `),
    archivedGoldenPicks: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/games/(gw-)?[0-9]+/golden/[^/]+$'
    `),
    archivedPowerups: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/games/(gw-)?[0-9]+/powerups/[^/]+$'
    `),
    archivedWeeklyScores: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/scores/(gw-)?[0-9]+/users/[^/]+$'
    `),
    archivedYearTablePicks: await scalar(`
      SELECT count(*) FROM firestore_documents
      WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/yearTable/meta/picks/[^/]+$'
    `),
    archivedUserYearTablePicks: await scalar(`
      SELECT count(*) FROM (
        SELECT DISTINCT
          substring(path from '^rooms/[^/]+/seasons/([^/]+)/') AS season_key,
          COALESCE(NULLIF(data->>'uid', ''), document_id) AS user_id
        FROM firestore_documents
        WHERE path ~ '^rooms/[^/]+/seasons/[^/]+/yearTable/meta/picks/[^/]+$'
      ) picks
    `),
    users: await scalar("SELECT count(*) FROM app_users"),
    rooms: await scalar("SELECT count(*) FROM rooms"),
    roomMembers: await scalar("SELECT count(*) FROM room_members"),
    games: await scalar("SELECT count(*) FROM games"),
    predictions: await scalar("SELECT count(*) FROM predictions"),
    goldenPicks: await scalar("SELECT count(*) FROM golden_picks"),
    powerups: await scalar("SELECT count(*) FROM powerups"),
    weeklyScores: await scalar("SELECT count(*) FROM weekly_scores"),
    yearTablePicks: await scalar("SELECT count(*) FROM year_table_picks"),
    userYearTablePicks: await scalar(
      "SELECT count(*) FROM user_year_table_picks",
    ),
    orphanMembers: await scalar(`
      SELECT count(*)
      FROM room_members member
      LEFT JOIN rooms room ON room.code = member.room_code
      LEFT JOIN app_users app_user ON app_user.firebase_uid = member.user_id
      WHERE room.code IS NULL OR app_user.firebase_uid IS NULL
    `),
    predictionUsersMissing: await scalar(`
      SELECT count(DISTINCT prediction.user_id)
      FROM predictions prediction
      LEFT JOIN app_users app_user
        ON app_user.firebase_uid = prediction.user_id
      WHERE app_user.firebase_uid IS NULL
    `),
    yearPickUsersMissing: await scalar(`
      SELECT count(DISTINCT pick.user_id)
      FROM user_year_table_picks pick
      LEFT JOIN app_users app_user
        ON app_user.firebase_uid = pick.user_id
      WHERE app_user.firebase_uid IS NULL
    `),
  };
  console.table(checks);
  if (checks.orphanMembers > 0) {
    throw new Error("Migration verification failed: orphan room members found");
  }
  if (checks.predictionUsersMissing > 0 || checks.yearPickUsersMissing > 0) {
    throw new Error(
      "Migration verification failed: prediction data is not attached to an app user",
    );
  }
  if (checks.archivedDocuments === 0) {
    throw new Error(
      "Migration verification failed: no Firestore documents archived",
    );
  }
  if (checks.rooms < checks.archivedRooms) {
    throw new Error(
      "Migration verification failed: rooms count is lower than archivedRooms",
    );
  }
  if (checks.roomMembers < checks.archivedRoomMembers) {
    throw new Error(
      "Migration verification failed: roomMembers count is lower than archivedRoomMembers",
    );
  }
  const projectedChecks = [
    ["games", "archivedGames"],
    ["predictions", "archivedPredictions"],
    ["goldenPicks", "archivedGoldenPicks"],
    ["powerups", "archivedPowerups"],
    ["weeklyScores", "archivedWeeklyScores"],
    ["yearTablePicks", "archivedYearTablePicks"],
    ["userYearTablePicks", "archivedUserYearTablePicks"],
  ];
  for (const [tableKey, archiveKey] of projectedChecks) {
    if (checks[tableKey] < checks[archiveKey]) {
      throw new Error(
        `Migration verification failed: ${tableKey} count is lower than ${archiveKey}`,
      );
    }
  }
  console.log("PostgreSQL migration verification passed.");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
