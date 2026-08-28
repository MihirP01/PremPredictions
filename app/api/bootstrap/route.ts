import { NextRequest, NextResponse } from "next/server";
import { canonicalRoomCode } from "@/lib/roomCode";
import { GET as getCurrentGameweek } from "../current-gameweek/route";
import {
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import {
  getPostgresGameState,
  getPostgresRoomSummary,
  PostgresRoomAccessError,
  PostgresRoomNotFoundError,
  requirePostgresRoomMember,
} from "@/lib/server/postgres-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CurrentGwPayload = {
  currentGameweek?: number;
  seasonKey?: string;
  predictionLockAt?: string | null;
  nextGameweekAt?: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const requested = canonicalRoomCode(req.nextUrl.searchParams.get("roomCode"));
    if (!requested) {
      return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
    }

    const user = await requireFirebaseUser(req);
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const room = await getPostgresRoomSummary(roomCode);
    const currentGwUrl = new URL("/api/current-gameweek", req.url);
    if (room.gameModeStyle === "league") currentGwUrl.searchParams.set("mode", "league");
    const currentGwRes = await getCurrentGameweek(new NextRequest(currentGwUrl));
    if (!currentGwRes.ok) {
      return NextResponse.json(
        { error: "Failed to resolve current gameweek" },
        { status: currentGwRes.status },
      );
    }

    const currentGwData = (await currentGwRes.json()) as CurrentGwPayload;
    const seasonKey = String(currentGwData.seasonKey || "");
    const currentGameweek = Number(currentGwData.currentGameweek ?? 1);
    const game =
      seasonKey && Number.isFinite(currentGameweek)
        ? await getPostgresGameState(roomCode, seasonKey, currentGameweek)
        : null;
    const seasonOptions = [...room.seasonOptions];
    if (seasonKey && !seasonOptions.includes(seasonKey)) seasonOptions.unshift(seasonKey);

    return NextResponse.json(
      {
        ok: true,
        roomCode: canonicalRoomCode(roomCode),
        seasonKey,
        currentGameweek: Number.isFinite(currentGameweek) ? currentGameweek : 1,
        predictionLockAt: currentGwData.predictionLockAt ?? null,
        nextGameweekAt: currentGwData.nextGameweekAt ?? null,
        gameState: String(game?.state || "LOBBY").toUpperCase(),
        leaderUid: room.leaderUid,
        themeAccent: room.themeAccent,
        gameModeStyle: room.gameModeStyle,
        allowIdenticalPicks: room.allowIdenticalPicks,
        powerupsEnabled: room.powerupsEnabled,
        leagueFairPlayEnabled: room.leagueFairPlayEnabled,
        hasPassword: room.hasPassword,
        seasonOptions,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          "Server-Timing": "source;desc=postgres",
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof PostgresRoomAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    if (error instanceof PostgresRoomNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to bootstrap" },
      { status: 500 },
    );
  }
}
