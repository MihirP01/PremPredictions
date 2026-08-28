import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

declare global {
  var __premPredictionsPool: Pool | undefined;
}

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPostgresPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalThis.__premPredictionsPool) {
    globalThis.__premPredictionsPool = new Pool({
      connectionString,
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "prem-predictions",
    });
  }

  return globalThis.__premPredictionsPool;
}

export function getPostgresDb() {
  return drizzle(getPostgresPool(), { schema });
}
