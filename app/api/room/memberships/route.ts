export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { listMemberRooms } from "@/lib/memberRoomsAdmin";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { uid?: string };
    const uid = String(body?.uid || "").trim();
    if (!uid) {
      return NextResponse.json({ error: "Missing uid." }, { status: 400 });
    }

    const rooms = await listMemberRooms(uid);
    return NextResponse.json({ rooms });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load rooms.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
