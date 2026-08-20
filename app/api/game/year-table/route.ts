export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../../../../firebase-admin";
import { resolveSeasonKey } from "../../season";
import { getBaseUrl } from "../lock-window";
import {
  YEAR_TABLE_LOCK_AFTER_GW,
  YEAR_TABLE_SCORE_AFTER_GW,
  clubsFromTableRows,
  type YearTableClub,
} from "@/lib/yearTableScoring";

type YearTableBody = {
  roomCode?: string;
  uid?: string;
  seasonKey?: string;
  order?: string[];
};

type TableApiRow = {
  position?: number;
  team?: {
    id?: number | null;
    name?: string;
    tla?: string | null;
    shortName?: string | null;
    badge?: string | null;
  };
};

type FixtureApiItem = {
  status?: string;
};

const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AWARDED"]);
const VOIDED_STATUSES = new Set(["POSTPONED", "SUSPENDED", "CANCELLED"]);

function validRoomCode(code: string) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

function asIso(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      toMillis?: () => number;
    };
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate();
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    if (typeof candidate.toMillis === "function") {
      const date = new Date(candidate.toMillis());
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
  }
  return null;
}

async function assertMember(roomCode: string, uid: string) {
  const playerSnap = await adminDb
    .doc(`rooms/${roomCode}/players/${uid}`)
    .get();
  if (!playerSnap.exists) {
    throw Object.assign(new Error("You are not in this room"), { status: 403 });
  }
}

async function resolveCurrentGw(req: Request, roomCode: string, seasonKey: string) {
  const roomSnap = await adminDb.doc(`rooms/${roomCode}`).get();
  const style = String(
    (roomSnap.data() as { settings?: { gameModeStyle?: string } } | undefined)
      ?.settings?.gameModeStyle || "",
  )
    .trim()
    .toLowerCase();
  const url = new URL("/api/current-gameweek", req.url);
  url.searchParams.set("seasonKey", seasonKey);
  if (style === "league") url.searchParams.set("mode", "league");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to resolve current gameweek");
  const data = (await res.json()) as { currentGameweek?: number };
  const gw = Number(data.currentGameweek ?? 1);
  return Number.isFinite(gw) ? gw : 1;
}

async function loadTableClubs(req: Request, seasonKey: string) {
  const res = await fetch(
    `${getBaseUrl(req)}/api/table?seasonKey=${encodeURIComponent(seasonKey)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to load Premier League table");
  const data = (await res.json()) as { standingsTotal?: TableApiRow[] };
  const clubs = clubsFromTableRows(
    Array.isArray(data.standingsTotal) ? data.standingsTotal : [],
  );
  if (clubs.length !== 20) {
    throw new Error("Need all 20 Premier League clubs before ranking");
  }
  return clubs;
}

async function isGw38Complete(req: Request, seasonKey: string) {
  try {
    const params = new URLSearchParams({
      gameweek: String(YEAR_TABLE_SCORE_AFTER_GW),
      seasonKey,
    });
    const res = await fetch(
      `${getBaseUrl(req)}/api/fixtures?${params.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { fixtures?: FixtureApiItem[] };
    const fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
    if (!fixtures.length) return false;
    const live = fixtures.filter((fixture) => {
      const status = String(fixture.status || "")
        .trim()
        .toUpperCase();
      return !VOIDED_STATUSES.has(status);
    });
    if (!live.length) return false;
    return live.every((fixture) =>
      FINISHED_STATUSES.has(
        String(fixture.status || "")
          .trim()
          .toUpperCase(),
      ),
    );
  } catch {
    return false;
  }
}

function yearTableRefs(roomCode: string, seasonKey: string) {
  const metaRef = adminDb.doc(
    `rooms/${roomCode}/seasons/${seasonKey}/yearTable/meta`,
  );
  const picksCol = adminDb.collection(
    `rooms/${roomCode}/seasons/${seasonKey}/yearTable/meta/picks`,
  );
  return { metaRef, picksCol };
}

function serializePick(
  uid: string,
  data: { order?: unknown; submittedAt?: unknown } | undefined,
) {
  const order = Array.isArray(data?.order)
    ? data.order.map((value) => String(value))
    : [];
  return {
    uid,
    order,
    submittedAt: asIso(data?.submittedAt),
  };
}

export async function GET(req: NextRequest) {
  try {
    const roomCode = String(req.nextUrl.searchParams.get("roomCode") || "")
      .trim()
      .toUpperCase();
    const uid = String(req.nextUrl.searchParams.get("uid") || "").trim();
    const seasonKey = resolveSeasonKey(req.nextUrl.searchParams.get("seasonKey"));

    if (!validRoomCode(roomCode) || !uid) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    await assertMember(roomCode, uid);
    const currentGw = await resolveCurrentGw(req, roomCode, seasonKey);
    const open = currentGw <= YEAR_TABLE_LOCK_AFTER_GW;
    const scoringOpen =
      currentGw >= YEAR_TABLE_SCORE_AFTER_GW &&
      (await isGw38Complete(req, seasonKey));

    const { metaRef, picksCol } = yearTableRefs(roomCode, seasonKey);
    const [metaSnap, picksSnap, clubs] = await Promise.all([
      metaRef.get(),
      picksCol.get(),
      loadTableClubs(req, seasonKey).catch(() => [] as YearTableClub[]),
    ]);

    const meta = metaSnap.data() as { teamKeys?: string[] } | undefined;
    const frozenKeys = Array.isArray(meta?.teamKeys)
      ? meta.teamKeys.map(String)
      : [];
    const clubByKey = new Map(clubs.map((club) => [club.key, club]));
    const teamKeys = frozenKeys.length ? frozenKeys : clubs.map((club) => club.key);
    const resolvedClubs = teamKeys.map(
      (key) =>
        clubByKey.get(key) || {
          key,
          name: key,
          tla: null,
          shortName: null,
          badge: null,
        },
    );

    const picks = picksSnap.docs.map((docSnap) =>
      serializePick(docSnap.id, docSnap.data() as { order?: unknown; submittedAt?: unknown }),
    );
    const myPick = picks.find((pick) => pick.uid === uid) ?? null;

    return NextResponse.json({
      ok: true,
      open,
      scoringOpen,
      currentGw,
      lockAfterGw: YEAR_TABLE_LOCK_AFTER_GW,
      teamKeys,
      clubs: resolvedClubs,
      myPick,
      picks,
    });
  } catch (error: unknown) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status) || 400
        : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load year table",
      },
      { status },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as YearTableBody;
    const roomCode = String(body.roomCode || "")
      .trim()
      .toUpperCase();
    const uid = String(body.uid || "").trim();
    const seasonKey = resolveSeasonKey(body.seasonKey);
    const submittedOrder = Array.isArray(body.order)
      ? body.order.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (!validRoomCode(roomCode) || !uid) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    await assertMember(roomCode, uid);
    const currentGw = await resolveCurrentGw(req, roomCode, seasonKey);
    if (currentGw > YEAR_TABLE_LOCK_AFTER_GW) {
      return NextResponse.json(
        { error: "Year predictions closed after GW5." },
        { status: 400 },
      );
    }

    const clubs = await loadTableClubs(req, seasonKey);
    const liveKeys = clubs.map((club) => club.key);
    const { metaRef, picksCol } = yearTableRefs(roomCode, seasonKey);
    const pickRef = picksCol.doc(uid);

    await adminDb.runTransaction(async (tx) => {
      const [metaSnap, pickSnap] = await Promise.all([
        tx.get(metaRef),
        tx.get(pickRef),
      ]);
      if (pickSnap.exists) {
        throw new Error("Your year predictions are already locked");
      }

      const meta = metaSnap.data() as { teamKeys?: string[] } | undefined;
      const teamKeys = Array.isArray(meta?.teamKeys) && meta.teamKeys.length
        ? meta.teamKeys.map(String)
        : liveKeys;
      if (teamKeys.length !== 20) {
        throw new Error("Need all 20 Premier League clubs before ranking");
      }

      const expected = new Set(teamKeys);
      const seen = new Set<string>();
      if (submittedOrder.length !== teamKeys.length) {
        throw new Error("Rank every club from 1 to 20");
      }
      for (const key of submittedOrder) {
        if (!expected.has(key) || seen.has(key)) {
          throw new Error("Each club can only appear once");
        }
        seen.add(key);
      }

      if (!metaSnap.exists || !Array.isArray(meta?.teamKeys)) {
        tx.set(
          metaRef,
          {
            teamKeys,
            lockAfterGw: YEAR_TABLE_LOCK_AFTER_GW,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: uid,
          },
          { merge: true },
        );
      }

      tx.set(pickRef, {
        uid,
        order: submittedOrder,
        submittedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status) || 400
        : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save year predictions",
      },
      { status },
    );
  }
}
