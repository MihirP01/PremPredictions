"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { collection, doc, onSnapshot, query } from "firebase/firestore";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  players: string[];
  order?: string[];
  fixtureIds: number[];
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  result?: string | null;
};

type PickDoc = {
  uid: string;
  fixtureId: number;
  score: string; // "2-1"
};

type GoldenDoc = {
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
};

type RoomPlayerDoc = { displayName?: string; nickName?: string };
const BTN_3D = "btn-3d-accent";

function fmtScore(s?: string | null) {
  if (!s) return "—";
  return s.replace("-", "–");
}

function teamAbbr(team: { name: string; tla?: string | null; shortName?: string }) {
  const tla = String(team.tla || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(tla)) return tla;
  const short = String(team.shortName || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(short)) return short;
  const words = String(team.name || "")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("");
  }
  return String(team.name || "FC").slice(0, 3).toUpperCase();
}

function TeamBadge({
  name,
  shortName,
  badge,
  tla,
}: {
  name: string;
  shortName?: string;
  badge?: string | null;
  tla?: string | null;
}) {
  const fallback = teamAbbr({ name, shortName, tla });
  return (
    <div className="h-10 w-10 rounded-full flex items-center justify-center overflow-hidden shrink-0">
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={badge} alt={name} className="h-8 w-8 object-contain" loading="lazy" />
      ) : (
        <span className="text-[10px] font-bold text-foreground">{fallback}</span>
      )}
    </div>
  );
}

function fmtKickoffParts(iso: string) {
  const dt = new Date(iso);
  const dayNum = dt.getDate();
  const suffix =
    dayNum % 10 === 1 && dayNum % 100 !== 11
      ? "st"
      : dayNum % 10 === 2 && dayNum % 100 !== 12
        ? "nd"
        : dayNum % 10 === 3 && dayNum % 100 !== 13
          ? "rd"
          : "th";
  const monthYear = dt.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
  const time = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { dayNum, suffix, monthYear, time };
}

export default function RevealPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  const [picks, setPicks] = useState<PickDoc[]>([]);
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [displayNamesByUid, setDisplayNamesByUid] = useState<
    Record<string, string>
  >({});

  const routedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  // current GW
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCurrentGameweekCached();
        const n = Number(data.currentGameweek ?? 1);
        if (!cancelled) {
          setGw(Number.isFinite(n) ? n : 1);
          setSeasonKey(String(data.seasonKey || ""));
        }
      } catch {
        if (!cancelled) {
          setGw(1);
          setSeasonKey("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // listen to game doc (for routing + player list + fixtureIds)
  useEffect(() => {
    if (!user || gw == null || !seasonKey) return;

    const gameRef = doc(
      db,
      "rooms",
      roomCode,
      "seasons",
      seasonKey,
      "games",
      `gw-${gw}`,
    );
    const unsub = onSnapshot(
      gameRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as GameDoc) : null;
        setGame(data);

        const st = String(data?.state ?? "")
          .trim()
          .toUpperCase();

        if (routedRef.current) return;

        // keep navigation consistent
        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
        } else if (st === "GOLDEN") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/golden`);
        } else if (st === "LOBBY") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame`);
        }
      },
      () => setError("Failed to load game state."),
    );

    return () => unsub();
  }, [user, roomCode, gw, router, seasonKey]);

  // load fixtures
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const r = await fetch(`/api/fixtures?gameweek=${gw}&seasonKey=${seasonKey}`, {
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      const fx: Fixture[] = Array.isArray(d?.fixtures) ? d.fixtures : [];
      if (!cancelled) setFixtures(fx);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw, seasonKey]);

  // listen picks
  useEffect(() => {
    if (gw == null || !seasonKey) return;

    const qPicks = query(
      collection(
        db,
        "rooms",
        roomCode,
        "seasons",
        seasonKey,
        "games",
        `gw-${gw}`,
        "picks",
      ),
    );
    return onSnapshot(
      qPicks,
      (snap) => {
        const list: PickDoc[] = snap.docs.map((d) => d.data() as PickDoc);
        setPicks(list);
      },
      () => setError("Failed to listen for picks."),
    );
  }, [roomCode, gw, seasonKey]);

  // listen golden
  useEffect(() => {
    if (gw == null || !seasonKey) return;

    const qGolden = query(
      collection(
        db,
        "rooms",
        roomCode,
        "seasons",
        seasonKey,
        "games",
        `gw-${gw}`,
        "golden",
      ),
    );
    return onSnapshot(
      qGolden,
      (snap) => {
        const map: Record<string, GoldenDoc> = {};
        for (const d of snap.docs) map[d.id] = d.data() as GoldenDoc;
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for goldens."),
    );
  }, [roomCode, gw, seasonKey]);

  // listen lobby display names (best-effort) so we can show names instead of UIDs
  useEffect(() => {
    const qPlayers = query(collection(db, "rooms", roomCode, "players"));
    return onSnapshot(
      qPlayers,
      (snap) => {
        const map: Record<string, string> = {};
        for (const d of snap.docs) {
          const data = d.data() as RoomPlayerDoc;
          const nick = String(data?.nickName || "").trim();
          map[d.id] = nick || data?.displayName || "Player";
        }
        setDisplayNamesByUid(map);
      },
      () => {},
    );
  }, [roomCode]);

  const players = useMemo(() => {
    // Prefer order if present (nice stable ordering)
    const arr = (game?.order?.length ? game.order : game?.players) ?? [];
    return Array.isArray(arr) ? arr : [];
  }, [game]);

  const fixtureIds = useMemo(() => {
    if (game?.fixtureIds?.length) return game.fixtureIds;
    return (fixtures ?? []).map((f) => f.fixtureId);
  }, [game, fixtures]);

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByUserFixture = useMemo(() => {
    const m = new Map<string, string>(); // key = uid|fixtureId
    for (const p of picks)
      m.set(`${p.uid}|${p.fixtureId}`, String(p.score ?? "").trim());
    return m;
  }, [picks]);

  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const allLocked = players.length > 0 && lockedCount >= players.length;

  if (loading || !user) return null;

  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Loading reveal…</div>
      </div>
    );
  }

  const state = String(game.state ?? "").toUpperCase();
  if (state !== "REVEAL") {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="w-full max-w-[900px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-3 border border-teal-500">
          <div className="text-xl font-semibold text-foreground">
            Reveal not ready
          </div>
          <div className="text-sm text-muted">Current state: {game.state}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Predictions Overview
            </h1>
            <div className="text-sm text-muted">
              {roomCode} • GW {gw}
            </div>
          </div>

          <button
            className={`text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 page-action-btn ${BTN_3D}`}
            onClick={() => router.push(`/room/${roomCode}`)}
          >
            Exit
          </button>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {!allLocked && (
          <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
            <div className="font-semibold text-foreground">
              Waiting for all golden picks…
            </div>
            <div className="text-sm text-muted mt-1">
              This screen will fill in as players lock.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {fixtureIds.map((fid) => {
            const f = fixtureMap.get(fid);
            const actual = f?.result ? fmtScore(f.result) : "TBD";
            const kickoffParts = f ? fmtKickoffParts(f.kickoff) : null;

            return (
              <div
                key={fid}
                className="border border-teal-500 rounded-xl p-[clamp(0.75rem,1.1vw,1.25rem)] bg-surface-2"
              >
                <div className="space-y-2">
                  <div className="text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted mb-1">
                    {kickoffParts ? (
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {kickoffParts.dayNum}
                          <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                            {kickoffParts.suffix}
                          </span>{" "}
                          {kickoffParts.monthYear}
                        </span>
                        <span className="tabular-nums">{kickoffParts.time}</span>
                      </div>
                    ) : (
                      <span>Fixture {fid}</span>
                    )}
                  </div>

                  {f && (
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div className="flex flex-col items-center text-center min-w-0">
                        <TeamBadge
                          name={f.home.name}
                          shortName={f.home.shortName}
                          badge={f.home.badge}
                          tla={f.home.tla}
                        />
                        <span className="mt-1 text-[clamp(0.82rem,1.05vw,1rem)] font-semibold text-foreground truncate w-full">
                          <span className="sm:hidden">{teamAbbr(f.home)}</span>
                          <span className="hidden sm:inline">{f.home.shortName || f.home.name}</span>
                        </span>
                      </div>
                      <div className="text-xs text-muted uppercase">vs</div>
                      <div className="flex flex-col items-center text-center min-w-0">
                        <TeamBadge
                          name={f.away.name}
                          shortName={f.away.shortName}
                          badge={f.away.badge}
                          tla={f.away.tla}
                        />
                        <span className="mt-1 text-[clamp(0.82rem,1.05vw,1rem)] font-semibold text-foreground truncate w-full">
                          <span className="sm:hidden">{teamAbbr(f.away)}</span>
                          <span className="hidden sm:inline">{f.away.shortName || f.away.name}</span>
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="text-center">
                    <div className="text-[clamp(0.85rem,1.1vw,1rem)] text-muted">Actual</div>
                    <div className="text-[clamp(1rem,1.5vw,1.3rem)] font-semibold text-foreground">
                      {actual}
                    </div>
                  </div>

                  <div className="text-xs text-muted text-center">Predictions</div>
                  <div className="flex flex-wrap items-start justify-center gap-2">
                    {players.map((uid) => {
                      const sc = picksByUserFixture.get(`${uid}|${fid}`) || "";
                      const g = goldensByUid[uid];
                      const isGolden = g?.locked && g?.fixtureId === fid;
                      return (
                        <div
                          key={`${fid}-${uid}`}
                          className="basis-[calc(50%-0.25rem)] sm:basis-[calc(33.333%-0.34rem)] min-w-0 text-center"
                        >
                          <div
                            className={[
                              "text-[11px] truncate",
                              isGolden ? "text-yellow-300 font-semibold" : "text-muted",
                            ].join(" ")}
                          >
                            {displayNamesByUid[uid] ?? uid.slice(0, 6)}
                          </div>
                          <span
                            className={[
                              "mt-1 inline-flex items-center justify-center rounded-full border border-subtle px-2.5 py-1 text-sm font-semibold text-foreground tabular-nums min-w-[58px]",
                              isGolden
                                ? "bg-gradient-to-r from-yellow-500/25 to-amber-300/15 border-yellow-300/70"
                                : "bg-surface/70",
                            ].join(" ")}
                          >
                            {fmtScore(sc)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
