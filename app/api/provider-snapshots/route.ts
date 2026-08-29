import { NextRequest, NextResponse } from "next/server";
import { resolveSeasonKey } from "../season";
import {
  PROVIDER_SNAPSHOT_KIND,
  getProviderSnapshotById,
  listProviderSnapshots,
  type ProviderSnapshotKind,
} from "@/lib/server/provider-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set<string>(Object.values(PROVIDER_SNAPSHOT_KIND));

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (Number.isInteger(id) && id > 0) {
    const snapshot = await getProviderSnapshotById(id);
    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: snapshot.id,
      kind: snapshot.kind,
      seasonKey: snapshot.seasonKey,
      gameweek: snapshot.gameweek,
      fixtureId: snapshot.fixtureId,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt.toISOString(),
      payloadHash: snapshot.payloadHash,
      payload: snapshot.payload,
    });
  }

  const kind = String(req.nextUrl.searchParams.get("kind") || "");
  if (!KINDS.has(kind)) {
    return NextResponse.json(
      {
        error: "kind is required",
        kinds: Object.values(PROVIDER_SNAPSHOT_KIND),
      },
      { status: 400 },
    );
  }

  const seasonKey = resolveSeasonKey(req.nextUrl.searchParams.get("seasonKey"));
  const gameweekRaw = req.nextUrl.searchParams.get("gameweek");
  const fixtureIdRaw = req.nextUrl.searchParams.get("fixtureId");
  const gameweek = Number(gameweekRaw);
  const fixtureId = Number(fixtureIdRaw);
  const snapshots = await listProviderSnapshots({
    kind: kind as ProviderSnapshotKind,
    seasonKey,
    gameweek: Number.isInteger(gameweek) ? gameweek : null,
    fixtureId: Number.isInteger(fixtureId) ? fixtureId : null,
    limit: Number(req.nextUrl.searchParams.get("limit") || 50),
  });

  return NextResponse.json({
    kind,
    seasonKey,
    gameweek: Number.isInteger(gameweek) ? gameweek : null,
    fixtureId: Number.isInteger(fixtureId) ? fixtureId : null,
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt.toISOString(),
      payloadHash: snapshot.payloadHash,
    })),
  });
}
