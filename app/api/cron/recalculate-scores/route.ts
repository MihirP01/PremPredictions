export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey } from "../../season";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === secret;
}

type RecalcResult = {
  roomCode: string;
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
};

async function runRecalcForRoom(
  origin: string,
  roomCode: string,
  gw: number,
  seasonKey: string,
): Promise<RecalcResult> {
  try {
    const res = await fetch(`${origin}/api/game/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ roomCode, gw, seasonKey }),
    });
    const payload = await res.json().catch(() => ({}));
    return {
      roomCode,
      ok: res.ok,
      status: res.status,
      payload,
      error: res.ok ? undefined : String((payload as { error?: string })?.error || "Failed"),
    };
  } catch (e: unknown) {
    return {
      roomCode,
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : "Request failed",
    };
  }
}

async function getCurrentGw(origin: string, seasonKey: string) {
  const res = await fetch(
    `${origin}/api/current-gameweek?seasonKey=${encodeURIComponent(seasonKey)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to resolve current gameweek");
  const data = (await res.json().catch(() => ({}))) as { gameweek?: number };
  const gw = Number(data?.gameweek);
  if (!Number.isFinite(gw) || gw < 1 || gw > 38) {
    throw new Error("Invalid gameweek");
  }
  return gw;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const origin = url.origin;
    const seasonKey = resolveSeasonKey(url.searchParams.get("seasonKey"));
    const gw = await getCurrentGw(origin, seasonKey);

    const roomsSnap = await adminDb.collection("rooms").get();
    const roomCodes = roomsSnap.docs.map((d) => d.id).filter(Boolean);

    const results: RecalcResult[] = [];
    for (const roomCode of roomCodes) {
      // Run one-by-one to avoid burst limits on upstream fixtures API.
      results.push(await runRecalcForRoom(origin, roomCode, gw, seasonKey));
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      ok: true,
      seasonKey,
      gw,
      rooms: roomCodes.length,
      success: okCount,
      failed: roomCodes.length - okCount,
      results,
      ranAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron recalc failed" },
      { status: 500 },
    );
  }
}

