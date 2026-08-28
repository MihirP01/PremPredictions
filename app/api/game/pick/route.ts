export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { canonicalRoomCode } from "@/lib/roomCode";
import { resolveSeasonKey } from "../../season";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { requirePostgresRoomMember } from "@/lib/server/postgres-read-model";

function validScore(value: string) {
  return /^\d+-\d+$/.test(value);
}

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as {
      roomCode?: string;
      gw?: number;
      uid?: string;
      score?: string;
      fixtureId?: number;
      seasonKey?: string;
    };
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const requestedFixture = Number(body.fixtureId);
    const score = String(body.score || "").trim();
    const seasonKey = resolveSeasonKey(body.seasonKey);
    if (!requested || !Number.isInteger(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Bad game request" }, { status: 400 });
    }
    if (body.uid && body.uid !== user.uid) {
      return NextResponse.json({ error: "User identity does not match session" }, { status: 401 });
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const gameResult = await client.query<{
        state: string;
        game_mode_style: string | null;
        fixture_ids: number[];
        data: Record<string, unknown>;
        same_result_lock: boolean;
      }>(
        `SELECT g.state, g.game_mode_style, g.fixture_ids, g.data, r.same_result_lock
           FROM games g JOIN rooms r ON r.code = g.room_code
          WHERE g.room_code = $1 AND g.season_key = $2 AND g.gameweek = $3 FOR UPDATE`,
        [roomCode, seasonKey, gw],
      );
      const row = gameResult.rows[0];
      if (!row) throw new Error("Game not started");
      if (row.state !== "DRAFT") throw new Error("Game not in DRAFT");
      if (row.game_mode_style === "league") throw new Error("Use the League gameweek submission form");
      const data = row.data && typeof row.data === "object" ? row.data : {};
      const order = Array.isArray(data.order) ? data.order.map(String) : [];
      const fixtureIds = Array.isArray(row.fixture_ids) ? row.fixture_ids.map(Number) : [];
      if (!order.length || !fixtureIds.length) throw new Error("Game is missing players or fixtures");
      const sameResultLock = typeof data.sameResultLock === "boolean" ? data.sameResultLock : row.same_result_lock;
      const draftMode = data.draftMode === "parallel" || data.draftMode === "turn"
        ? data.draftMode
        : sameResultLock ? "turn" : "parallel";
      const currentTurn = Number(data.currentTurn ?? 0);
      const totalTurns = Number(data.totalTurns ?? order.length * fixtureIds.length);
      const gameMode = String(row.game_mode_style || data.gameModeStyle || "round_robin");
      const captain = gameMode === "captain";
      const captainParallel = captain && !sameResultLock;
      const ready = data.draftReadyByUid && typeof data.draftReadyByUid === "object"
        ? { ...(data.draftReadyByUid as Record<string, boolean>) }
        : {};
      let shouldWrite = true;
      let fixtureId: number;

      const fixtureAlreadyUsed = async (id: number) => {
        const result = await client.query(
          `SELECT 1 FROM predictions WHERE room_code = $1 AND season_key = $2
            AND gameweek = $3 AND fixture_id = $4 LIMIT 1`,
          [roomCode, seasonKey, gw, id],
        );
        return Boolean(result.rowCount);
      };

      if (captainParallel) {
        if (currentTurn >= fixtureIds.length) throw new Error("Draft already complete");
        const captainUid = order[currentTurn % order.length];
        const stored = Number(data.currentFixtureId);
        const hasStored = Number.isFinite(stored) && fixtureIds.includes(stored);
        if (!hasStored) {
          if (user.uid !== captainUid) throw new Error("Waiting for captain to choose fixture");
          if (!Number.isFinite(requestedFixture) || !fixtureIds.includes(requestedFixture)) throw new Error("Captain must choose a valid fixture");
          if (await fixtureAlreadyUsed(requestedFixture)) throw new Error("Fixture already completed");
          fixtureId = requestedFixture;
          shouldWrite = false;
        } else {
          fixtureId = stored;
          if (Number.isFinite(requestedFixture) && requestedFixture !== fixtureId) throw new Error("This fixture is locked for this round");
          if (!validScore(score)) throw new Error("Bad score");
        }
      } else if (draftMode === "parallel") {
        if (currentTurn >= fixtureIds.length) throw new Error("Draft already complete");
        fixtureId = fixtureIds[currentTurn];
        if (Number.isFinite(requestedFixture) && requestedFixture !== fixtureId) throw new Error("This fixture is locked. Wait for current round to complete.");
        if (!validScore(score)) throw new Error("Bad score");
      } else {
        if (currentTurn >= totalTurns) throw new Error("Draft already complete");
        const fixtureIndex = Math.floor(currentTurn / order.length);
        const turnInFixture = currentTurn % order.length;
        const currentUid = order[(turnInFixture + fixtureIndex) % order.length];
        if (currentUid !== user.uid) throw new Error("Not your turn");
        if (captain) {
          const stored = Number(data.currentFixtureId);
          const hasStored = Number.isFinite(stored) && fixtureIds.includes(stored);
          if (turnInFixture === 0 && !hasStored) {
            if (!Number.isFinite(requestedFixture) || !fixtureIds.includes(requestedFixture)) throw new Error("Captain must choose a valid fixture");
            if (await fixtureAlreadyUsed(requestedFixture)) throw new Error("Fixture already completed");
            fixtureId = requestedFixture;
            shouldWrite = false;
          } else {
            if (!hasStored) throw new Error("Waiting for captain to choose fixture");
            fixtureId = stored;
            if (Number.isFinite(requestedFixture) && requestedFixture !== fixtureId) throw new Error("This fixture is locked for this round");
          }
        } else {
          fixtureId = fixtureIds[fixtureIndex];
        }
        if (shouldWrite && !validScore(score)) throw new Error("Bad score");
      }

      if (shouldWrite) {
        const existing = await client.query(
          `SELECT 1 FROM predictions WHERE room_code = $1 AND season_key = $2
            AND gameweek = $3 AND user_id = $4 AND fixture_id = $5 LIMIT 1`,
          [roomCode, seasonKey, gw, user.uid, fixtureId],
        );
        if (existing.rowCount) throw new Error("You already picked this fixture");
        if (sameResultLock) {
          const duplicate = await client.query(
            `SELECT 1 FROM predictions WHERE room_code = $1 AND season_key = $2
              AND gameweek = $3 AND fixture_id = $4 AND score = $5 LIMIT 1`,
            [roomCode, seasonKey, gw, fixtureId, score],
          );
          if (duplicate.rowCount) throw new Error("Score already taken for this fixture");
        }
        await client.query(
          `INSERT INTO predictions
             (room_code, season_key, gameweek, user_id, fixture_id, score, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6,
             jsonb_build_object('uid', $4, 'fixtureId', $5, 'score', $6), now())`,
          [roomCode, seasonKey, gw, user.uid, fixtureId, score],
        );
      }

      const next = { ...data } as Record<string, unknown>;
      let nextState = row.state;
      if (captainParallel) {
        const hasSelected = Number.isFinite(Number(data.currentFixtureId)) && fixtureIds.includes(Number(data.currentFixtureId));
        if (!hasSelected || !shouldWrite) {
          next.currentFixtureId = fixtureId;
          next.draftReadyByUid = {};
        } else {
          ready[user.uid] = true;
          if (order.every((uid) => ready[uid])) {
            const following = currentTurn + 1;
            next.currentTurn = following;
            next.currentFixtureId = null;
            next.draftReadyByUid = {};
            if (following >= fixtureIds.length) nextState = "GOLDEN";
          } else next.draftReadyByUid = ready;
        }
      } else if (draftMode === "parallel") {
        ready[user.uid] = true;
        if (order.every((uid) => ready[uid])) {
          const following = currentTurn + 1;
          next.currentTurn = following;
          next.draftReadyByUid = {};
          if (following >= fixtureIds.length) nextState = "GOLDEN";
        } else next.draftReadyByUid = ready;
      } else {
        const following = currentTurn + 1;
        if (captain && !shouldWrite) next.currentFixtureId = fixtureId;
        else {
          next.currentTurn = following;
          if (captain) next.currentFixtureId = following % order.length === 0 ? null : fixtureId;
          if (following >= totalTurns) {
            nextState = "GOLDEN";
            if (captain) next.currentFixtureId = null;
          }
        }
      }
      next.state = nextState;
      await client.query(
        `UPDATE games SET state = $4, data = $5::jsonb, updated_at = now()
          WHERE room_code = $1 AND season_key = $2 AND gameweek = $3`,
        [roomCode, seasonKey, gw, nextState, JSON.stringify(next)],
      );
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "pick failed" }, { status: 400 });
  }
}
