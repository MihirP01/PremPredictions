import "server-only";

import { createHash } from "node:crypto";
import { isPostgresConfigured, getPostgresPool } from "./postgres";

export const PROVIDER_SNAPSHOT_KIND = {
  fixtures: "fixtures",
  fotmobLeague: "fotmob-league",
  standings: "standings",
  matchInfo: "match-info",
} as const;

export type ProviderSnapshotKind =
  (typeof PROVIDER_SNAPSHOT_KIND)[keyof typeof PROVIDER_SNAPSHOT_KIND];

export type ProviderSnapshotKey = {
  kind: ProviderSnapshotKind;
  seasonKey: string;
  gameweek?: number | null;
  fixtureId?: number | null;
};

export type ProviderSnapshotRecord<T = Record<string, unknown>> = {
  id: number;
  kind: ProviderSnapshotKind;
  seasonKey: string;
  gameweek: number | null;
  fixtureId: number | null;
  source: string | null;
  payload: T;
  payloadHash: string;
  capturedAt: Date;
};

type SnapshotRow = {
  id: string | number;
  kind: string;
  season_key: string;
  gameweek: number | null;
  fixture_id: string | number | null;
  source: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  captured_at: Date;
};

function normalizeKey(key: ProviderSnapshotKey): ProviderSnapshotKey | null {
  const seasonKey = String(key.seasonKey || "").trim();
  if (!seasonKey) return null;
  const gameweek = Number(key.gameweek);
  const fixtureId = Number(key.fixtureId);
  return {
    kind: key.kind,
    seasonKey,
    gameweek: Number.isInteger(gameweek) ? gameweek : null,
    fixtureId: Number.isInteger(fixtureId) ? fixtureId : null,
  };
}

export function hashProviderPayload(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload ?? {}))
    .digest("hex");
}

export function parseSnapshotAt(value: unknown): Date | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function mapRow<T>(row: SnapshotRow): ProviderSnapshotRecord<T> {
  return {
    id: Number(row.id),
    kind: row.kind as ProviderSnapshotKind,
    seasonKey: row.season_key,
    gameweek: row.gameweek == null ? null : Number(row.gameweek),
    fixtureId:
      row.fixture_id == null || row.fixture_id === ""
        ? null
        : Number(row.fixture_id),
    source: row.source,
    payload: (row.payload || {}) as T,
    payloadHash: row.payload_hash,
    capturedAt: new Date(row.captured_at),
  };
}

export function isSnapshotFresh(
  capturedAt: Date | string | null | undefined,
  ttlMs: number,
) {
  if (!capturedAt || !Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const ms = capturedAt instanceof Date ? capturedAt.getTime() : Date.parse(String(capturedAt));
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms < ttlMs;
}

export async function getProviderSnapshotById<T = Record<string, unknown>>(
  id: number,
): Promise<ProviderSnapshotRecord<T> | null> {
  if (!Number.isInteger(id) || id <= 0 || !isPostgresConfigured()) return null;
  const result = await getPostgresPool().query<SnapshotRow>(
    `SELECT id, kind, season_key, gameweek, fixture_id, source, payload, payload_hash, captured_at
       FROM provider_snapshots
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapRow<T>(row) : null;
}

export async function getLatestProviderSnapshot<T = Record<string, unknown>>(
  key: ProviderSnapshotKey,
): Promise<ProviderSnapshotRecord<T> | null> {
  const normalized = normalizeKey(key);
  if (!normalized || !isPostgresConfigured()) return null;
  const result = await getPostgresPool().query<SnapshotRow>(
    `SELECT id, kind, season_key, gameweek, fixture_id, source, payload, payload_hash, captured_at
       FROM provider_snapshots
      WHERE kind = $1
        AND season_key = $2
        AND gameweek IS NOT DISTINCT FROM $3
        AND fixture_id IS NOT DISTINCT FROM $4
      ORDER BY captured_at DESC, id DESC
      LIMIT 1`,
    [
      normalized.kind,
      normalized.seasonKey,
      normalized.gameweek,
      normalized.fixtureId,
    ],
  );
  const row = result.rows[0];
  return row ? mapRow<T>(row) : null;
}

export async function getProviderSnapshotAt<T = Record<string, unknown>>(
  key: ProviderSnapshotKey,
  at: Date,
): Promise<ProviderSnapshotRecord<T> | null> {
  const normalized = normalizeKey(key);
  if (!normalized || !isPostgresConfigured()) return null;
  const result = await getPostgresPool().query<SnapshotRow>(
    `SELECT id, kind, season_key, gameweek, fixture_id, source, payload, payload_hash, captured_at
       FROM provider_snapshots
      WHERE kind = $1
        AND season_key = $2
        AND gameweek IS NOT DISTINCT FROM $3
        AND fixture_id IS NOT DISTINCT FROM $4
        AND captured_at <= $5
      ORDER BY captured_at DESC, id DESC
      LIMIT 1`,
    [
      normalized.kind,
      normalized.seasonKey,
      normalized.gameweek,
      normalized.fixtureId,
      at.toISOString(),
    ],
  );
  const row = result.rows[0];
  return row ? mapRow<T>(row) : null;
}

export async function listProviderSnapshots(args: {
  kind: ProviderSnapshotKind;
  seasonKey: string;
  gameweek?: number | null;
  fixtureId?: number | null;
  limit?: number;
}): Promise<Array<Omit<ProviderSnapshotRecord, "payload">>> {
  const normalized = normalizeKey(args);
  if (!normalized || !isPostgresConfigured()) return [];
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
  const result = await getPostgresPool().query<SnapshotRow>(
    `SELECT id, kind, season_key, gameweek, fixture_id, source, payload_hash, captured_at,
            '{}'::jsonb AS payload
       FROM provider_snapshots
      WHERE kind = $1
        AND season_key = $2
        AND ($3::int IS NULL OR gameweek IS NOT DISTINCT FROM $3)
        AND ($4::bigint IS NULL OR fixture_id IS NOT DISTINCT FROM $4)
      ORDER BY captured_at DESC, id DESC
      LIMIT $5`,
    [
      normalized.kind,
      normalized.seasonKey,
      args.gameweek == null ? null : normalized.gameweek,
      args.fixtureId == null ? null : normalized.fixtureId,
      limit,
    ],
  );
  return result.rows.map((row) => {
    const mapped = mapRow(row);
    const { payload: _payload, ...rest } = mapped;
    return rest;
  });
}

export async function saveProviderSnapshot<T>(
  key: ProviderSnapshotKey,
  payload: T,
  source?: string | null,
): Promise<ProviderSnapshotRecord<T> | null> {
  const normalized = normalizeKey(key);
  if (!normalized || !isPostgresConfigured()) return null;
  const hash = hashProviderPayload(payload);
  const result = await getPostgresPool().query<SnapshotRow>(
    `WITH latest AS (
       SELECT payload_hash
         FROM provider_snapshots
        WHERE kind = $1
          AND season_key = $2
          AND gameweek IS NOT DISTINCT FROM $3
          AND fixture_id IS NOT DISTINCT FROM $4
        ORDER BY captured_at DESC, id DESC
        LIMIT 1
     ),
     inserted AS (
       INSERT INTO provider_snapshots
         (kind, season_key, gameweek, fixture_id, source, payload, payload_hash, captured_at)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, $7, now()
        WHERE NOT EXISTS (
          SELECT 1 FROM latest WHERE payload_hash = $7
        )
       RETURNING id, kind, season_key, gameweek, fixture_id, source, payload, payload_hash, captured_at
     )
     SELECT * FROM (
       SELECT * FROM inserted
       UNION ALL
       SELECT id, kind, season_key, gameweek, fixture_id, source, payload, payload_hash, captured_at
         FROM provider_snapshots
        WHERE kind = $1
          AND season_key = $2
          AND gameweek IS NOT DISTINCT FROM $3
          AND fixture_id IS NOT DISTINCT FROM $4
          AND NOT EXISTS (SELECT 1 FROM inserted)
     ) snap
     ORDER BY captured_at DESC, id DESC
     LIMIT 1`,
    [
      normalized.kind,
      normalized.seasonKey,
      normalized.gameweek,
      normalized.fixtureId,
      source ? String(source) : null,
      JSON.stringify(payload ?? {}),
      hash,
    ],
  );
  const row = result.rows[0];
  return row ? mapRow<T>(row) : null;
}
