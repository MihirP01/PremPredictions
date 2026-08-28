export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode } from "@/lib/roomCode";
import { resolveSeasonKey } from "../../season";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { requirePostgresRoomMember } from "@/lib/server/postgres-read-model";

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as { roomCode?: string; gw?: number; uid?: string; fixtureId?: number; score?: string; seasonKey?: string };
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const fixtureId = Number(body.fixtureId);
    const score = String(body.score || "").trim();
    const seasonKey = resolveSeasonKey(body.seasonKey);
    if (!requested || !Number.isInteger(gw) || !Number.isFinite(fixtureId) || (body.uid && body.uid !== user.uid)) {
      return NextResponse.json({ error: "Bad input" }, { status: 400 });
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const gameResult = await client.query<{ state: string; data: Record<string, unknown> }>(
        "SELECT state, data FROM games WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 FOR UPDATE",
        [roomCode, seasonKey, gw],
      );
      const game = gameResult.rows[0];
      if (!game) throw new Error("Game missing");
      if (game.state !== "GOLDEN") throw new Error("Not in GOLDEN phase");
      const players = Array.isArray(game.data?.players) ? game.data.players.map(String) : [];
      if (!players.includes(user.uid)) throw new Error("You are not in this game");
      const pick = await client.query<{ score: string | null }>(
        `SELECT score FROM predictions
          WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 AND user_id = $4 AND fixture_id = $5`,
        [roomCode, seasonKey, gw, user.uid, fixtureId],
      );
      if (!pick.rowCount || String(pick.rows[0].score || "") !== score) {
        throw new Error("Golden must match your own pick score");
      }
      const existing = await client.query<{ locked: boolean }>(
        `SELECT locked FROM golden_picks
          WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 AND user_id = $4`,
        [roomCode, seasonKey, gw, user.uid],
      );
      if (existing.rows[0]?.locked) throw new Error("Golden already locked");
      await client.query(
        `INSERT INTO golden_picks
           (room_code, season_key, gameweek, user_id, fixture_id, score, locked, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true,
           jsonb_build_object('uid', $4, 'fixtureId', $5, 'score', $6, 'locked', true), now())
         ON CONFLICT (room_code, season_key, gameweek, user_id)
         DO UPDATE SET fixture_id = EXCLUDED.fixture_id, score = EXCLUDED.score,
           locked = true, data = EXCLUDED.data, updated_at = now()`,
        [roomCode, seasonKey, gw, user.uid, fixtureId, score],
      );
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM golden_picks
          WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 AND locked = true`,
        [roomCode, seasonKey, gw],
      );
      if (Number(count.rows[0]?.count || 0) >= players.length) {
        const nextState = game.data?.powerupsEnabled === true ? "POWERUPS" : "REVEAL";
        await client.query(
          "UPDATE games SET state = $4, data = jsonb_set(data, '{state}', to_jsonb($4::varchar)), updated_at = now() WHERE room_code = $1 AND season_key = $2 AND gameweek = $3",
          [roomCode, seasonKey, gw, nextState],
        );
      }
      await client.query("COMMIT");
      return NextResponse.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "golden failed" }, { status: 400 });
  }
}
