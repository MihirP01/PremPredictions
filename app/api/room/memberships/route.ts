export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  assertClaimedUid,
  AuthenticationError,
  requireFirebaseUser,
} from "@/lib/server/firebase-auth";
import { resolvePostgresRoomAccess } from "@/lib/server/postgres-room-repository";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      uid?: string;
      mode?: "fast" | "all";
      preferredRoomCode?: string;
    };
    const authenticatedUser = await requireFirebaseUser(req);
    const uid = assertClaimedUid(authenticatedUser, body?.uid);

    const resolution = await resolvePostgresRoomAccess(uid);
    return NextResponse.json(
      body.mode === "fast" ? resolution : { rooms: resolution.rooms },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load rooms.";
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: msg }, { status: e.status });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
