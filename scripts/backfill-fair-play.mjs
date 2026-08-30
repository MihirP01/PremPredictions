import pg from "pg";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function hasPrediction(scoreRow) {
  const data = record(scoreRow.data);
  const status = String(data.scoreStatus || "").toLowerCase();
  if (status === "scored") return true;
  if (status === "missed" || status === "fair_play_bye") return false;
  return Object.values(record(data.breakdown)).some((item) =>
    Boolean(String(record(item).pred || "").trim()),
  );
}

function completedWeek(game, scoreRows) {
  const data = record(game.data);
  const voided = new Set(
    Array.isArray(data.voidedFixtureIds)
      ? data.voidedFixtureIds.map(Number).filter(Number.isFinite)
      : [],
  );
  const required = (Array.isArray(game.fixture_ids) ? game.fixture_ids : [])
    .map(Number)
    .filter((fixtureId) => Number.isFinite(fixtureId) && !voided.has(fixtureId));
  if (!required.length) return false;

  const completed = new Set();
  for (const scoreRow of scoreRows) {
    const breakdown = record(record(scoreRow.data).breakdown);
    for (const [fixtureId, item] of Object.entries(breakdown)) {
      if (String(record(item).actual || "").trim()) {
        completed.add(Number(fixtureId));
      }
    }
  }
  return required.every((fixtureId) => completed.has(fixtureId));
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: npm run db:backfill-fair-play -- --room ROOM --season 2627 [--user UID] [--apply]",
  );
  process.exitCode = 1;
}

const roomInput = option("room").toUpperCase();
const seasonInput = option("season");
const userInput = option("user");
const apply = process.argv.includes("--apply");

if (!roomInput || !seasonInput) {
  usage("Both --room and --season are required.");
} else if (!/^\d{4}$/.test(seasonInput)) {
  usage("--season must be a four-digit season key such as 2627.");
} else if (!process.env.DATABASE_URL?.trim()) {
  usage("DATABASE_URL is not configured.");
} else {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    application_name: "prem-predictions-fair-play-backfill",
  });

  try {
    const roomResult = await pool.query(
      `SELECT code, game_mode_style, league_fair_play_enabled
         FROM rooms
        WHERE upper(code) = $1
        LIMIT 1`,
      [roomInput],
    );
    const room = roomResult.rows[0];
    if (!room) throw new Error(`Room ${roomInput} was not found.`);
    if (room.game_mode_style !== "league") {
      throw new Error(`Room ${room.code} is not in League mode.`);
    }
    if (!room.league_fair_play_enabled) {
      throw new Error(`Fair Play is not enabled for room ${room.code}.`);
    }

    const memberParams = [room.code];
    let memberFilter = "";
    if (userInput) {
      memberParams.push(userInput);
      memberFilter = " AND user_id = $2";
    }
    const [membersResult, gamesResult, scoresResult] = await Promise.all([
      pool.query(
        `SELECT user_id, COALESCE(NULLIF(nickname, ''), display_name, user_id) AS display_name,
                joined_at
           FROM room_members
          WHERE room_code = $1${memberFilter}
          ORDER BY joined_at, user_id`,
        memberParams,
      ),
      pool.query(
        `SELECT season_key, gameweek, fixture_ids, data
           FROM games
          WHERE room_code = $1 AND season_key = $2
            AND COALESCE(game_mode_style, data->>'gameModeStyle') = 'league'
          ORDER BY gameweek`,
        [room.code, seasonInput],
      ),
      pool.query(
        `SELECT season_key, gameweek, user_id, points, fair_play_bye, data
           FROM weekly_scores
          WHERE room_code = $1 AND season_key = $2
          ORDER BY gameweek, user_id`,
        [room.code, seasonInput],
      ),
    ]);

    if (userInput && membersResult.rows.length === 0) {
      throw new Error(`User ${userInput} is not a member of room ${room.code}.`);
    }

    const scoresByGameweek = new Map();
    const existing = new Set();
    for (const scoreRow of scoresResult.rows) {
      const gameweek = Number(scoreRow.gameweek);
      const rows = scoresByGameweek.get(gameweek) || [];
      rows.push(scoreRow);
      scoresByGameweek.set(gameweek, rows);
      existing.add(`${gameweek}|${scoreRow.user_id}`);
    }

    const awards = [];
    const skippedWeeks = [];
    for (const game of gamesResult.rows) {
      const gameweek = Number(game.gameweek);
      const scoreRows = scoresByGameweek.get(gameweek) || [];
      if (!scoreRows.length || !completedWeek(game, scoreRows)) {
        skippedWeeks.push(gameweek);
        continue;
      }

      const submittedPoints = scoreRows
        .filter(hasPrediction)
        .map((scoreRow) => {
          const rawPoints = number(record(scoreRow.data).rawPoints);
          return rawPoints ?? number(scoreRow.points);
        })
        .filter((points) => points != null);
      const fairPlayMedian = median(submittedPoints);
      if (fairPlayMedian == null) continue;

      const lockAtMs = Date.parse(String(record(game.data).lockAt || ""));
      if (!Number.isFinite(lockAtMs)) {
        skippedWeeks.push(gameweek);
        continue;
      }

      for (const member of membersResult.rows) {
        if (existing.has(`${gameweek}|${member.user_id}`)) continue;
        const joinedAtMs = new Date(member.joined_at).getTime();
        if (!Number.isFinite(joinedAtMs) || joinedAtMs <= lockAtMs) continue;
        awards.push({
          roomCode: room.code,
          seasonKey: seasonInput,
          gameweek,
          userId: member.user_id,
          displayName: member.display_name,
          points: Math.round((fairPlayMedian / 2) * 100) / 100,
          fairPlayMedian,
        });
      }
    }

    console.log(
      `${apply ? "APPLY" : "DRY RUN"}: ${awards.length} Fair Play bye(s) for ${room.code} ${seasonInput}.`,
    );
    if (skippedWeeks.length) {
      console.log(
        `Skipped incomplete/unscored gameweeks: ${[...new Set(skippedWeeks)].join(", ")}.`,
      );
    }
    if (awards.length) {
      console.table(
        awards.map(({ displayName, gameweek, points, fairPlayMedian }) => ({
          player: displayName,
          gameweek,
          points,
          median: fairPlayMedian,
        })),
      );
    }

    if (apply && awards.length) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const award of awards) {
          const now = new Date().toISOString();
          const data = {
            uid: award.userId,
            gw: award.gameweek,
            points: award.points,
            rawPoints: 0,
            breakdown: {},
            scoreStatus: "fair_play_bye",
            fairPlayApplied: true,
            fairPlayMedian: award.fairPlayMedian,
            backfilledAt: now,
            backfillReason: "joined_after_gameweek_lock",
          };
          await client.query(
            `INSERT INTO weekly_scores
               (room_code, season_key, gameweek, user_id, points, fair_play_bye, data, updated_at)
             VALUES ($1, $2, $3, $4, $5, true, $6::jsonb, now())
             ON CONFLICT (room_code, season_key, gameweek, user_id) DO NOTHING`,
            [
              award.roomCode,
              award.seasonKey,
              award.gameweek,
              award.userId,
              award.points,
              JSON.stringify(data),
            ],
          );
        }
        await client.query("COMMIT");
        console.log(`Applied ${awards.length} Fair Play bye(s).`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else if (!apply && awards.length) {
      console.log("No changes made. Re-run with --apply after reviewing the table.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
