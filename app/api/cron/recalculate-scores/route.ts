export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveSeasonKey } from "../../season";
import { scoreRoomGameweek } from "@/app/api/game/score/route";
import { getPostgresPool } from "@/lib/server/postgres";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") && auth.slice(7).trim() === secret;
}

function baseUrl(req: Request) {
  const host = req.headers.get("host");
  const protocol = req.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let stage = "init";
  try {
    const url = new URL(req.url);
    const seasonKey = resolveSeasonKey(url.searchParams.get("seasonKey"));
    stage = "current-gw";
    const current = await fetch(
      `${baseUrl(req)}/api/current-gameweek?seasonKey=${encodeURIComponent(seasonKey)}`,
      { cache: "no-store" },
    );
    if (!current.ok) throw new Error(`Current gameweek API error: ${current.status}`);
    const currentData = (await current.json()) as { currentGameweek?: number };
    const gw = Number(currentData.currentGameweek);
    if (!Number.isInteger(gw) || gw < 1 || gw > 38) throw new Error("Invalid gameweek");

    stage = "load-rooms";
    const rooms = await getPostgresPool().query<{ code: string }>("SELECT code FROM rooms ORDER BY code");
    stage = "recalculate";
    const results = [];
    for (const room of rooms.rows) {
      try {
        const result = await scoreRoomGameweek(baseUrl(req), room.code, gw, seasonKey);
        results.push({
          roomCode: room.code,
          ok: true,
          status: 200,
          payload: {
            ok: true,
            scored: result.status === "scored" ? result.scoredUsers : 0,
            scoredGameweeks: result.status === "scored" ? 1 : 0,
            targetGws: [gw],
            seasonKey,
            results: [result],
          },
        });
      } catch (error) {
        results.push({
          roomCode: room.code,
          ok: false,
          status: 500,
          error: error instanceof Error ? error.message : "Recalc failed",
        });
      }
    }
    const success = results.filter((result) => result.ok).length;
    return NextResponse.json({
      ok: true,
      seasonKey,
      gw,
      rooms: rooms.rows.length,
      success,
      failed: rooms.rows.length - success,
      results,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron recalc failed", stage },
      { status: 500 },
    );
  }
}
