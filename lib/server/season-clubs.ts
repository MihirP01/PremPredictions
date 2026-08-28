import "server-only";

import { getPostgresPool } from "./postgres";

export type SeasonClub = {
  teamId: number;
  name: string;
  tla: string | null;
  shortName: string | null;
  badgeUrl: string | null;
};

const COMPLETE_CATALOG_SIZE = 20;
const COMPLETE_CACHE_MS = 6 * 60 * 60 * 1000;
const INCOMPLETE_CACHE_MS = 30 * 1000;
const catalogCache = new Map<
  string,
  { expiresAt: number; clubs: SeasonClub[] }
>();
const pending = new Map<string, Promise<SeasonClub[]>>();

function seasonStartYearFromKey(seasonKey: string) {
  return 2000 + Number(String(seasonKey).slice(0, 2));
}

function cacheCatalog(seasonKey: string, clubs: SeasonClub[]) {
  catalogCache.set(seasonKey, {
    expiresAt:
      Date.now() +
      (clubs.length === COMPLETE_CATALOG_SIZE
        ? COMPLETE_CACHE_MS
        : INCOMPLETE_CACHE_MS),
    clubs,
  });
  return clubs;
}

async function readStoredCatalog(seasonKey: string): Promise<SeasonClub[]> {
  const result = await getPostgresPool().query<{
    team_id: number;
    name: string;
    tla: string | null;
    short_name: string | null;
    badge_url: string | null;
  }>(
    `SELECT team_id, name, tla, short_name, badge_url
       FROM season_clubs
      WHERE season_key = $1
      ORDER BY name`,
    [seasonKey],
  );
  return result.rows.map((row) => ({
    teamId: Number(row.team_id),
    name: row.name,
    tla: row.tla,
    shortName: row.short_name,
    badgeUrl: row.badge_url,
  }));
}

function normalizeProviderClub(value: unknown): SeasonClub | null {
  const club = (value || {}) as {
    id?: unknown;
    name?: unknown;
    tla?: unknown;
    shortName?: unknown;
    crest?: unknown;
  };
  const teamId = Number(club.id);
  const name = String(club.name || "").trim();
  if (!Number.isInteger(teamId) || teamId <= 0 || !name) return null;
  const nullable = (input: unknown) => {
    const text = String(input || "").trim();
    return text || null;
  };
  return {
    teamId,
    name,
    tla: nullable(club.tla)?.toUpperCase() ?? null,
    shortName: nullable(club.shortName),
    badgeUrl: nullable(club.crest),
  };
}

async function replaceStoredCatalog(seasonKey: string, clubs: SeasonClub[]) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO season_clubs
         (season_key, team_id, name, tla, short_name, badge_url, source, data, updated_at)
       SELECT $1, item.team_id, item.name, item.tla, item.short_name,
              item.badge_url, 'football-data', '{}'::jsonb, now()
         FROM jsonb_to_recordset($2::jsonb) AS item(
           team_id integer,
           name text,
           tla text,
           short_name text,
           badge_url text
         )
       ON CONFLICT (season_key, team_id) DO UPDATE SET
         name = EXCLUDED.name,
         tla = COALESCE(EXCLUDED.tla, season_clubs.tla),
         short_name = COALESCE(EXCLUDED.short_name, season_clubs.short_name),
         badge_url = COALESCE(EXCLUDED.badge_url, season_clubs.badge_url),
         source = EXCLUDED.source,
         updated_at = now()`,
      [
        seasonKey,
        JSON.stringify(
          clubs.map((club) => ({
            team_id: club.teamId,
            name: club.name,
            tla: club.tla,
            short_name: club.shortName,
            badge_url: club.badgeUrl,
          })),
        ),
      ],
    );
    if (clubs.length === COMPLETE_CATALOG_SIZE) {
      await client.query(
        `DELETE FROM season_clubs
          WHERE season_key = $1
            AND NOT (team_id = ANY($2::integer[]))`,
        [seasonKey, clubs.map((club) => club.teamId)],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function fetchAndStoreCatalog(
  seasonKey: string,
  apiKey: string,
  fallback: SeasonClub[],
) {
  const season = seasonStartYearFromKey(seasonKey);
  const response = await fetch(
    `https://api.football-data.org/v4/competitions/PL/teams?season=${season}`,
    {
      headers: { "X-Auth-Token": apiKey },
      next: { revalidate: 24 * 60 * 60 },
    },
  );
  if (!response.ok) return cacheCatalog(seasonKey, fallback);
  const payload = (await response.json().catch(() => ({}))) as {
    teams?: unknown[];
  };
  const clubs = (Array.isArray(payload.teams) ? payload.teams : [])
    .map(normalizeProviderClub)
    .filter((club): club is SeasonClub => club !== null);
  if (!clubs.length) return cacheCatalog(seasonKey, fallback);
  await replaceStoredCatalog(seasonKey, clubs);
  return cacheCatalog(seasonKey, await readStoredCatalog(seasonKey));
}

export function getSeasonClubCatalog(
  seasonKey: string,
  apiKey: string,
): Promise<SeasonClub[]> {
  const season = String(seasonKey || "");
  const cached = catalogCache.get(season);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.clubs);
  }
  const existing = pending.get(season);
  if (existing) return existing;

  const request = (async () => {
    const stored = await readStoredCatalog(season);
    if (stored.length === COMPLETE_CATALOG_SIZE || !apiKey) {
      return cacheCatalog(season, stored);
    }
    return fetchAndStoreCatalog(season, apiKey, stored);
  })().finally(() => pending.delete(season));
  pending.set(season, request);
  return request;
}
