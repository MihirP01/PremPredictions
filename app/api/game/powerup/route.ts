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
    const body = (await req.json()) as {
      roomCode?: string;
      gw?: number;
      uid?: string;
      fixtureId?: number;
      powerupType?: "ALL_IN" | "SAFETY_NET";
      seasonKey?: string;
    };
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const fixtureId = Number(body.fixtureId);
    const powerupType = String(body.powerupType || "").toUpperCase();
    const seasonKey = resolveSeasonKey(body.seasonKey);
    if (!requested || !Number.isInteger(gw) || !Number.isFinite(fixtureId) || !["ALL_IN", "SAFETY_NET"].includes(powerupType)) {
      return NextResponse.json({ error: "Bad input" }, { status: 400 });
    }
    if (body.uid && body.uid !== user.uid) return NextResponse.json({ error: "User identity does not match session" }, { status: 401 });
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
      if (game.state !== "POWERUPS" || game.data?.powerupsEnabled !== true) throw new Error("Not in POWERUPS phase");
      const players = Array.isArray(game.data?.players) ? game.data.players.map(String) : [];
      if (!players.includes(user.uid)) throw new Error("You are not in this game");
      const pick = await client.query<{ score: string | null }>(
        `SELECT score FROM predictions WHERE room_code = $1 AND season_key = $2
          AND gameweek = $3 AND user_id = $4 AND fixture_id = $5`,
        [roomCode, seasonKey, gw, user.uid, fixtureId],
      );
      if (!pick.rowCount) throw new Error("You can only place a power-up on your own pick");
      const golden = await client.query<{ fixture_id: number | null; locked: boolean }>(
        `SELECT fixture_id, locked FROM golden_picks WHERE room_code = $1 AND season_key = $2
          AND gameweek = $3 AND user_id = $4`,
        [roomCode, seasonKey, gw, user.uid],
      );
      if (golden.rows[0]?.locked && Number(golden.rows[0].fixture_id) === fixtureId) {
        throw new Error("Power-Up cannot be used on your Golden fixture");
      }
      const existing = await client.query<{ locked: boolean }>(
        `SELECT locked FROM powerups WHERE room_code = $1 AND season_key = $2
          AND gameweek = $3 AND user_id = $4`,
        [roomCode, seasonKey, gw, user.uid],
      );
      if (existing.rows[0]?.locked) throw new Error("Power-up already locked");
      await client.query(
        `INSERT INTO powerups
           (room_code, season_key, gameweek, user_id, fixture_id, powerup_type, locked, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true,
           jsonb_build_object('uid', $4, 'fixtureId', $5, 'powerupType', $6, 'locked', true), now())
         ON CONFLICT (room_code, season_key, gameweek, user_id)
         DO UPDATE SET fixture_id = EXCLUDED.fixture_id, powerup_type = EXCLUDED.powerup_type,
           locked = true, data = EXCLUDED.data, updated_at = now()`,
        [roomCode, seasonKey, gw, user.uid, fixtureId, powerupType],
      );
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM powerups
          WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 AND locked = true`,
        [roomCode, seasonKey, gw],
      );
      if (Number(count.rows[0]?.count || 0) >= players.length) {
        await client.query(
          "UPDATE games SET state = 'REVEAL', data = jsonb_set(data, '{state}', '\"REVEAL\"'::jsonb), updated_at = now() WHERE room_code = $1 AND season_key = $2 AND gameweek = $3",
          [roomCode, seasonKey, gw],
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "powerup failed" }, { status: 400 });
  }
}
