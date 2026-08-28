export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { resolveSeasonKey } from "../../season";
import { getBaseUrl } from "../lock-window";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { GET as getCurrentGameweek } from "../../current-gameweek/route";
import {
  YEAR_TABLE_LOCK_AFTER_GW,
  YEAR_TABLE_SCORE_AFTER_GW,
  clubsFromTableRows,
  type YearTableClub,
} from "@/lib/yearTableScoring";
import {
  isCompleteYearOrder,
  insertUserYearTablePick,
  syncUserYearTablePick,
} from "@/lib/yearTableSync";
import { AuthenticationError, requireFirebaseUser } from "@/lib/server/firebase-auth";
import { getPostgresPool } from "@/lib/server/postgres";
import { getPostgresRoomSummary, requirePostgresRoomMember } from "@/lib/server/postgres-read-model";
import { getSeasonClubCatalog } from "@/lib/server/season-clubs";

type TableRow = { position?: number; team?: { id?: number | null; name?: string; tla?: string | null; shortName?: string | null; badge?: string | null } };
const FINISHED = new Set(["FINISHED", "FT", "AWARDED"]);
const VOIDED = new Set(["POSTPONED", "SUSPENDED", "CANCELLED"]);

async function currentGw(req: Request, roomCode: string, seasonKey: string) {
  const room = await getPostgresRoomSummary(roomCode);
  const url = new URL("/api/current-gameweek", req.url);
  url.searchParams.set("seasonKey", seasonKey);
  if (room.gameModeStyle === "league") url.searchParams.set("mode", "league");
  const response = await getCurrentGameweek(new NextRequest(url));
  if (!response.ok) throw new Error("Failed to resolve current gameweek");
  return Number(((await response.json()) as { currentGameweek?: number }).currentGameweek || 1);
}

function clubsFromCatalog(
  catalog: Array<{
    teamId: number;
    name: string;
    tla: string | null;
    shortName: string | null;
    badgeUrl: string | null;
  }>,
): YearTableClub[] {
  const clubs: YearTableClub[] = [];
  const seen = new Set<string>();
  for (const club of catalog) {
    const key = String(club.teamId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clubs.push({
      key,
      id: club.teamId,
      name: club.name,
      tla: club.tla,
      shortName: club.shortName,
      badge: club.badgeUrl,
      position: null,
    });
  }
  return clubs;
}

function resolveSubmittedOrder(order: string[], clubs: YearTableClub[]) {
  const byId = new Map(clubs.map((club) => [club.key, club.key]));
  const byTla = new Map(
    clubs
      .filter((club) => club.tla)
      .map((club) => [String(club.tla).trim().toUpperCase(), club.key]),
  );
  const byName = new Map(
    clubs.map((club) => [String(club.name || "").trim().toUpperCase(), club.key]),
  );
  const resolved = order.map((value) => {
    const key = String(value || "").trim();
    if (!key) return "";
    return (
      byId.get(key) ||
      byTla.get(key.toUpperCase()) ||
      byName.get(key.toUpperCase()) ||
      ""
    );
  });
  if (
    resolved.length !== 20 ||
    resolved.some((key) => !key) ||
    new Set(resolved).size !== 20
  ) {
    return null;
  }
  return resolved;
}

async function clubs(req: Request, seasonKey: string) {
  const catalog = await getSeasonClubCatalog(
    seasonKey,
    process.env.FOOTBALLDATA_KEY || "",
  ).catch(() => []);
  const fromCatalog = clubsFromCatalog(catalog);
  if (fromCatalog.length === 20) return fromCatalog;

  const response = await fetch(
    `${getBaseUrl(req)}/api/table?seasonKey=${encodeURIComponent(seasonKey)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Failed to load Premier League clubs");
  const data = (await response.json()) as { standingsTotal?: TableRow[] };
  const result = clubsFromTableRows(data.standingsTotal ?? []);
  if (result.length !== 20) {
    throw new Error("Need all 20 Premier League clubs before ranking");
  }
  return result;
}

async function gw38Complete(req: Request, seasonKey: string) {
  try {
    const response = await fetch(
      `${getBaseUrl(req)}/api/fixtures?gameweek=${YEAR_TABLE_SCORE_AFTER_GW}&seasonKey=${encodeURIComponent(seasonKey)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { fixtures?: Array<{ status?: string }> };
    const live = (data.fixtures ?? []).filter((fixture) => !VOIDED.has(String(fixture.status || "").toUpperCase()));
    return live.length > 0 && live.every((fixture) => FINISHED.has(String(fixture.status || "").toUpperCase()));
  } catch {
    return false;
  }
}

function publicYearTableError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    !message ||
    /inconsistent types|parameter \$|syntax error|relation |column /i.test(message)
  ) {
    return fallback;
  }
  return message;
}

async function loadPicks(roomCode: string, seasonKey: string) {
  const result = await getPostgresPool().query<{
    user_id: string;
    club_order: string[];
    submitted_at: Date | null;
  }>(
    `SELECT pick.user_id, pick.club_order, pick.submitted_at
       FROM user_year_table_picks pick
       JOIN room_members member ON member.user_id = pick.user_id
      WHERE upper(member.room_code) = $1 AND pick.season_key = $2
      ORDER BY pick.submitted_at, pick.user_id`,
    [canonicalRoomCode(roomCode), seasonKey],
  );
  return result.rows.map((row) => ({
    uid: row.user_id,
    order: Array.isArray(row.club_order) ? row.club_order.map(String) : [],
    submittedAt: row.submitted_at?.toISOString() ?? null,
  }));
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireFirebaseUser(req);
    const requested = canonicalRoomCode(req.nextUrl.searchParams.get("roomCode"));
    const seasonKey = resolveSeasonKey(req.nextUrl.searchParams.get("seasonKey"));
    if (!isValidRoomCode(requested)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    const [gw, clubList] = await Promise.all([
      currentGw(req, roomCode, seasonKey),
      clubs(req, seasonKey).catch(() => [] as YearTableClub[]),
    ]);
    let picks = await loadPicks(roomCode, seasonKey);
    let myPick = picks.find((pick) => pick.uid === user.uid) ?? null;
    if (!myPick || !isCompleteYearOrder(myPick.order)) {
      await syncUserYearTablePick({ uid: user.uid, seasonKey, sourceRoomCode: roomCode });
      picks = await loadPicks(roomCode, seasonKey);
      myPick = picks.find((pick) => pick.uid === user.uid) ?? null;
    }
    const teamKeys = clubList.map((club) => club.key);
    return NextResponse.json({
      ok: true,
      open: gw <= YEAR_TABLE_LOCK_AFTER_GW,
      scoringOpen: gw >= YEAR_TABLE_SCORE_AFTER_GW && (await gw38Complete(req, seasonKey)),
      currentGw: gw,
      lockAfterGw: YEAR_TABLE_LOCK_AFTER_GW,
      teamKeys,
      clubs: clubList,
      myPick,
      picks,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: publicYearTableError(error, "Failed to load year predictions") }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireFirebaseUser(req);
    const body = (await req.json()) as { roomCode?: string; uid?: string; seasonKey?: string; order?: string[] };
    const requested = canonicalRoomCode(body.roomCode);
    const seasonKey = resolveSeasonKey(body.seasonKey);
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    if (!isValidRoomCode(requested) || (body.uid && body.uid !== user.uid)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const roomCode = await requirePostgresRoomMember(requested, user.uid);
    if ((await currentGw(req, roomCode, seasonKey)) > YEAR_TABLE_LOCK_AFTER_GW) {
      return NextResponse.json({ error: "Year predictions close at the start of GW3." }, { status: 400 });
    }
    const clubList = await clubs(req, seasonKey);
    const resolvedOrder = resolveSubmittedOrder(order, clubList);
    if (!resolvedOrder) {
      return NextResponse.json({ error: "Rank every club from 1 to 20, once each" }, { status: 400 });
    }
    await syncUserYearTablePick({ uid: user.uid, seasonKey });
    const result = await insertUserYearTablePick(
      user.uid,
      seasonKey,
      resolvedOrder,
    );
    if (!result.rowCount) return NextResponse.json({ error: "Your year predictions are already locked" }, { status: 400 });
    await syncUserYearTablePick({
      uid: user.uid,
      seasonKey,
      sourceRoomCode: roomCode,
      sourceOrder: resolvedOrder,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: publicYearTableError(error, "Failed to save year predictions") }, { status: 400 });
  }
}
