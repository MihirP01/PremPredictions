import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../firebase-admin";

type CurrentGwPayload = {
  currentGameweek?: number;
  seasonKey?: string;
};

function normalizeRoomCode(value: string) {
  return String(value || "").trim().toUpperCase();
}

export async function GET(req: NextRequest) {
  try {
    const roomCode = normalizeRoomCode(req.nextUrl.searchParams.get("roomCode") || "");
    if (!roomCode) {
      return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
    }

    const currentGwRes = await fetch(new URL("/api/current-gameweek", req.url), {
      cache: "no-store",
    });
    if (!currentGwRes.ok) {
      return NextResponse.json(
        { error: "Failed to resolve current gameweek" },
        { status: currentGwRes.status },
      );
    }

    const currentGwData = (await currentGwRes.json()) as CurrentGwPayload;
    const seasonKey = String(currentGwData.seasonKey || "");
    const currentGameweek = Number(currentGwData.currentGameweek ?? 1);

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const roomSnap = await roomRef.get();
    const room = roomSnap.data() as
      | {
          leaderUid?: string;
          settings?: {
            themeAccent?: string;
            gameModeStyle?: "round_robin" | "sprint" | "captain";
            sameResultLock?: boolean;
          };
        }
      | undefined;

    let gameState = "LOBBY";
    if (seasonKey && Number.isFinite(currentGameweek)) {
      const gameRef = adminDb.doc(
        `rooms/${roomCode}/seasons/${seasonKey}/games/gw-${currentGameweek}`,
      );
      const gameSnap = await gameRef.get();
      const raw = gameSnap.data() as { state?: string } | undefined;
      gameState = String(raw?.state || "LOBBY").trim().toUpperCase() || "LOBBY";
    }

    const seasonsSnap = await adminDb.collection(`rooms/${roomCode}/seasons`).get();
    const seasonOptions = seasonsSnap.docs
      .map((d) => String(d.id))
      .filter((id) => /^\d{4}$/.test(id))
      .sort((a, b) => b.localeCompare(a));
    if (seasonKey && !seasonOptions.includes(seasonKey)) seasonOptions.unshift(seasonKey);

    return NextResponse.json(
      {
        ok: true,
        roomCode,
        seasonKey,
        currentGameweek: Number.isFinite(currentGameweek) ? currentGameweek : 1,
        gameState,
        leaderUid: room?.leaderUid ?? null,
        themeAccent: room?.settings?.themeAccent ?? "teal",
        gameModeStyle: room?.settings?.gameModeStyle ?? "sprint",
        allowIdenticalPicks: room?.settings?.sameResultLock === false,
        seasonOptions,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to bootstrap",
      },
      { status: 500 },
    );
  }
}
