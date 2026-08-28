#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import pg from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.log(
    "DATABASE_URL is not configured; skipping PostgreSQL migrations.",
  );
  process.exit(0);
}

const migrationsDirectory = path.resolve(process.cwd(), "db/migrations");
if (!fs.existsSync(migrationsDirectory)) {
  throw new Error(`Migration directory not found: ${migrationsDirectory}`);
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: "prem-predictions-schema-migrator",
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations = fs
      .readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of migrations) {
      const applied = await client.query(
        "SELECT 1 FROM app_schema_migrations WHERE name = $1",
        [name],
      );
      if (applied.rowCount) continue;

      const sql = fs.readFileSync(path.join(migrationsDirectory, name), "utf8");
      console.log(`Applying PostgreSQL migration ${name}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO app_schema_migrations (name) VALUES ($1)",
          [name],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.log("PostgreSQL schema is current.");
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
