export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveSeasonKey } from "../../season";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { getBaseUrl, loadGwFixturesWithLockWindow } from "../lock-window";
import { ensureLeagueDraftGame } from "../league-game";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { requirePostgresRoomMember } from "@/lib/server/postgres-read-model";

function score(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{1,2}-\d{1,2}$/.test(normalized)) throw new Error("Scores must use the format 2-1");
  return normalized;
}

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as {
      roomCode?: string;
      gw?: number;
      uid?: string;
      seasonKey?: string;
      picks?: Array<{ fixtureId?: number; score?: string | null }>;
    };
    const requested = canonicalRoomCode(body.roomCode);
    const gw = Number(body.gw);
    const seasonKey = resolveSeasonKey(body.seasonKey);
    if (!isValidRoomCode(requested) || !Number.isInteger(gw) || gw < 1 || gw > 38) {
      return NextResponse.json({ error: "Invalid game request" }, { status: 400 });
    }
    if (body.uid && body.uid !== user.uid) {
      return NextResponse.json({ error: "User identity does not match session" }, { status: 401 });
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const fixtures = await loadGwFixturesWithLockWindow(getBaseUrl(req), gw, seasonKey, { lockMode: "league" });
    if (Date.now() >= fixtures.lockAt.getTime()) {
      return NextResponse.json(
        { error: "League predictions lock 30 minutes before the first game of the gameweek." },
        { status: 400 },
      );
    }
    let exists = await getPostgresPool().query(
      "SELECT 1 FROM games WHERE room_code = $1 AND season_key = $2 AND gameweek = $3",
      [roomCode, seasonKey, gw],
    );
    if (!exists.rowCount) {
      await ensureLeagueDraftGame({ req, roomCode, gw, seasonKey, uid: user.uid });
      exists = await getPostgresPool().query(
        "SELECT 1 FROM games WHERE room_code = $1 AND season_key = $2 AND gameweek = $3",
        [roomCode, seasonKey, gw],
      );
    }

    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const gameResult = await client.query<{
        state: string;
        game_mode_style: string | null;
        fixture_ids: number[];
        data: Record<string, unknown>;
      }>(
        `SELECT state, game_mode_style, fixture_ids, data FROM games
          WHERE room_code = $1 AND season_key = $2 AND gameweek = $3 FOR UPDATE`,
        [roomCode, seasonKey, gw],
      );
      const row = gameResult.rows[0];
      if (!row || row.state !== "DRAFT" || row.game_mode_style !== "league") {
        throw new Error("League predictions are not open");
      }
      const data = row.data && typeof row.data === "object" ? row.data : {};
      const submitted =
        data.leagueSubmittedByUid && typeof data.leagueSubmittedByUid === "object"
          ? { ...(data.leagueSubmittedByUid as Record<string, boolean>) }
          : {};
      if (submitted[user.uid]) throw new Error("Your League predictions are already locked");
      const currentEligible = new Set(fixtures.fixtureIds);
      const voided = new Set(
        Array.isArray(data.voidedFixtureIds)
          ? data.voidedFixtureIds.map(Number).filter(Number.isFinite)
          : [],
      );
      const fixtureIds = Array.isArray(row.fixture_ids) ? row.fixture_ids.map(Number) : [];
      fixtureIds.forEach((id) => { if (!currentEligible.has(id)) voided.add(id); });
      const required = fixtureIds.filter((id) => !voided.has(id));
      if (!required.length) throw new Error("There are no eligible fixtures left to predict");
      const allowed = new Set(required);
      const picks = new Map<number, string>();
      for (const input of body.picks ?? []) {
        const fixtureId = Number(input.fixtureId);
        if (!Number.isFinite(fixtureId) || !allowed.has(fixtureId)) {
          throw new Error("A submitted fixture is not part of this gameweek");
        }
        if (picks.has(fixtureId)) throw new Error("A fixture was submitted more than once");
        picks.set(fixtureId, score(input.score));
      }
      if (picks.size !== required.length || required.some((id) => !picks.has(id))) {
        throw new Error("Predict every eligible fixture before submitting");
      }
      for (const fixtureId of required) {
        const prediction = picks.get(fixtureId) as string;
        const predictionData = {
          uid: user.uid,
          fixtureId,
          score: prediction,
        };
        await client.query(
          `INSERT INTO predictions
             (room_code, season_key, gameweek, user_id, fixture_id, score, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
           ON CONFLICT (room_code, season_key, gameweek, user_id, fixture_id)
           DO UPDATE SET score = EXCLUDED.score, data = EXCLUDED.data, updated_at = now()`,
          [
            roomCode,
            seasonKey,
            gw,
            user.uid,
            fixtureId,
            prediction,
            JSON.stringify(predictionData),
          ],
        );
      }
      submitted[user.uid] = true;
      const players = Array.isArray(data.players) ? data.players.map(String) : [];
      if (!players.includes(user.uid)) players.push(user.uid);
      const nextData = {
        ...data,
        players,
        leagueSubmittedByUid: submitted,
        voidedFixtureIds: [...voided].sort((a, b) => a - b),
        firstKickoffAt: fixtures.firstKickoffAt.toISOString(),
        lockAt: fixtures.lockAt.toISOString(),
      };
      await client.query(
        "UPDATE games SET data = $4::jsonb, updated_at = now() WHERE room_code = $1 AND season_key = $2 AND gameweek = $3",
        [roomCode, seasonKey, gw, JSON.stringify(nextData)],
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, savedCount: required.length });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save picks" },
      { status: 400 },
    );
  }
}
