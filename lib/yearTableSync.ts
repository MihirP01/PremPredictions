import "server-only";

import { getPostgresPool } from "./server/postgres";

export function isCompleteYearOrder(order: unknown): order is string[] {
  if (!Array.isArray(order) || order.length !== 20) return false;
  const normalized = order.map((value) => String(value || "").trim());
  return normalized.every(Boolean) && new Set(normalized).size === 20;
}

export async function syncUserYearTablePick(args: {
  uid: string;
  seasonKey: string;
  sourceRoomCode?: string;
  sourceOrder?: string[];
}) {
  let order = args.sourceOrder && isCompleteYearOrder(args.sourceOrder)
    ? args.sourceOrder.map(String)
    : null;
  if (!order) {
    const source = await getPostgresPool().query<{ club_order: string[] }>(
      `SELECT club_order FROM user_year_table_picks
        WHERE user_id = $1 AND season_key = $2
        LIMIT 1`,
      [args.uid, args.seasonKey],
    );
    if (isCompleteYearOrder(source.rows[0]?.club_order)) order = source.rows[0].club_order.map(String);
  }
  if (!order) {
    const legacy = await getPostgresPool().query<{ club_order: string[] }>(
      `SELECT club_order FROM year_table_picks
        WHERE user_id = $1 AND season_key = $2
        ORDER BY (room_code = $3) DESC, submitted_at ASC NULLS LAST
        LIMIT 1`,
      [args.uid, args.seasonKey, args.sourceRoomCode || ""],
    );
    if (isCompleteYearOrder(legacy.rows[0]?.club_order)) {
      order = legacy.rows[0].club_order.map(String);
    }
  }
  if (!order) return { created: false };

  const result = await insertUserYearTablePick(
    args.uid,
    args.seasonKey,
    order,
  );
  return { created: Boolean(result.rowCount) };
}

export async function insertUserYearTablePick(
  uid: string,
  seasonKey: string,
  order: string[],
) {
  // Use a separate $4 for the jsonb uid. Reusing $2 as varchar and $2::text
  // makes Postgres fail with "inconsistent types deduced for parameter $2".
  return getPostgresPool().query(
    `INSERT INTO user_year_table_picks
       (season_key, user_id, club_order, data, submitted_at, updated_at)
     VALUES ($1, $2, $3::jsonb,
       jsonb_build_object('uid', $4::text, 'order', $3::jsonb), now(), now())
     ON CONFLICT (season_key, user_id) DO NOTHING`,
    [seasonKey, uid, JSON.stringify(order), uid],
  );
}
