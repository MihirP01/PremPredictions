"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { coerceMillis, ONE_HOUR_MS } from "../lock-utils";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  order: string[];
  fixtureIds: number[];
  currentTurn: number;
  totalTurns: number;
  players: string[];
  lockAt?: unknown;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: { name: string; shortName?: string; badge?: string | null };
  away: { name: string; shortName?: string; badge?: string | null };
  result?: string | null;
};

type PickDoc = { score?: string };
type RoomPlayerDoc = { displayName?: string; nickName?: string };
const BTN_3D = "btn-3d-accent";

function onlyDigitsOrEmpty(v: string) {
  return v === "" || /^\d+$/.test(v);
}

function fmtKickoffTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtKickoffDateWithOrdinal(iso: string) {
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
  return { dayNum, suffix, monthYear };
}

function TeamBadge({
  name,
  shortName,
  badge,
}: {
  name: string;
  shortName?: string;
  badge?: string | null;
}) {
  const fallback = (shortName || name || "FC").slice(0, 3).toUpperCase();
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

export default function MiniGamePlayPage() {
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

  const [takenScores, setTakenScores] = useState<string[]>([]);
  const [displayNamesByUid, setDisplayNamesByUid] = useState<Record<string, string>>(
    {},
  );
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());

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

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // load fixtures for GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const r = await fetch(`/api/fixtures?gameweek=${gw}&seasonKey=${seasonKey}`);
      const d = await r.json();
      if (!cancelled) setFixtures(Array.isArray(d?.fixtures) ? d.fixtures : []);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw, seasonKey]);

  // listen to game doc
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    const gameRef = doc(
      db,
      "rooms",
      roomCode,
      "seasons",
      seasonKey,
      "games",
      `gw-${gw}`,
    );
    return onSnapshot(gameRef, (snap) => {
      setGame(snap.exists() ? (snap.data() as GameDoc) : null);
    });
  }, [roomCode, gw, seasonKey]);

  const current = useMemo(() => {
    if (!game) return null;
    const order = game.order || [];
    const fixtureIds = game.fixtureIds || [];
    const turn = game.currentTurn ?? 0;
    if (!order.length || !fixtureIds.length) return null;

    const P = order.length;
    const fixtureIndex = Math.floor(turn / P);
    if (fixtureIndex >= fixtureIds.length) return null;

    const turnInFixture = turn % P;

    // ✅ ROTATION: each new fixture shifts who goes first
    const rotatedIndex = (turnInFixture + fixtureIndex) % P;

    const uidTurn = order[rotatedIndex];
    const fixtureId = fixtureIds[fixtureIndex];

    return {
      uidTurn,
      fixtureId,
      fixtureIndex,
      turn,
      rotatedIndex,
      turnInFixture,
    };
  }, [game]);

  const amITurn = !!user && !!current && current.uidTurn === user.uid;

  // listen to taken scores for current fixture
  useEffect(() => {
    if (gw == null || !current || !seasonKey) return;

    const picksQ = query(
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
      where("fixtureId", "==", current.fixtureId),
    );

    return onSnapshot(picksQ, (snap) => {
      const scores = snap.docs.map((d) => String((d.data() as PickDoc).score));
      setTakenScores(scores);
    });
  }, [roomCode, gw, current, seasonKey]);

  // player display names (nickname first)
  useEffect(() => {
    const qPlayers = query(collection(db, "rooms", roomCode, "players"));
    return onSnapshot(
      qPlayers,
      (snap) => {
        const map: Record<string, string> = {};
        for (const d of snap.docs) {
          const data = d.data() as RoomPlayerDoc;
          const nick = String(data?.nickName || "").trim();
          map[d.id] = nick || data?.displayName || d.id.slice(0, 6);
        }
        setDisplayNamesByUid(map);
      },
      () => {},
    );
  }, [roomCode]);

  useEffect(() => {
    // reset inputs when fixture changes
    setHomeScore("");
    setAwayScore("");
    setErr(null);
  }, [current?.fixtureId]);

  if (gw == null || fixtures == null) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Game not started yet.</div>
      </div>
    );
  }

  // phase routing
  if (game.state === "GOLDEN") {
    router.replace(`/room/${roomCode}/minigame/golden`);
    return null;
  }
  if (game.state === "REVEAL") {
    router.replace(`/room/${roomCode}/minigame/reveal`);
    return null;
  }

  const fixture = fixtures.find((f) => f.fixtureId === current?.fixtureId);
  const gameLockAtMs = coerceMillis(game?.lockAt);
  const fallbackLockAtMs = fixtures.length
    ? fixtures
        .map((f) => Date.parse(String(f.kickoff || "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)[0] - ONE_HOUR_MS
    : null;
  const lockAtMs =
    gameLockAtMs ??
    (Number.isFinite(fallbackLockAtMs ?? NaN) ? fallbackLockAtMs : null);
  const isLocked = lockAtMs != null && nowMs >= lockAtMs;

  const submitPick = async () => {
    if (!current || !user) return;
    if (isLocked) {
      setErr("Mini-game is locked (deadline passed).");
      return;
    }
    if (homeScore === "" || awayScore === "") {
      setErr("Enter both scores.");
      return;
    }
    const score = `${homeScore}-${awayScore}`;

    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/game/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, gw, uid: user.uid, score, seasonKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Pick failed");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Pick failed");
    } finally {
      setSubmitting(false);
    }
  };

  const totalTurns = Math.max(Number(game.totalTurns ?? 0), 1);
  const turnNumber = Math.min(totalTurns, Number(game.currentTurn ?? 0) + 1);
  const turnsRemaining = Math.max(totalTurns - turnNumber, 0);
  const turnProgress = Math.min(turnNumber / totalTurns, 1);
  const turnRingLength = 213.63;
  const currentTurnName = current?.uidTurn
    ? displayNamesByUid[current.uidTurn] || current.uidTurn.slice(0, 6)
    : "current player";

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted">
              Room {roomCode} • GW {gw}
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              Predicicton Round-Robin
            </h1>
          </div>
        </div>

        <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
          <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_auto_1fr] items-center gap-3">
            <div className="relative w-16 h-16">
              <svg
                className="absolute inset-0 w-full h-full -rotate-90"
                viewBox="0 0 80 80"
                aria-hidden="true"
              >
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  fill="none"
                  stroke="rgba(45, 212, 191, 0.2)"
                  strokeWidth="4"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  fill="none"
                  stroke="#2dd4bf"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={turnRingLength}
                  strokeDashoffset={turnRingLength - turnProgress * turnRingLength}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-semibold text-foreground leading-none">
                  {turnsRemaining}
                </span>
              </div>
            </div>

            <div className="hidden sm:flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/pl-lion.png"
                alt="Premier League"
                className="h-12 w-12 object-contain"
                loading="lazy"
              />
            </div>

            <div className="text-right sm:text-left">
              <div className="text-base font-semibold text-foreground">Turn {turnNumber}</div>
              <div className="text-xs text-muted uppercase tracking-wide">Out of {totalTurns}</div>
            </div>
          </div>
        </div>
        {/* fixture */}
        <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
          {fixture && (
            <div className="space-y-2 mb-2">
              <div className="relative text-xs text-muted h-4">
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  {(() => {
                    const d = fmtKickoffDateWithOrdinal(fixture.kickoff);
                    return (
                      <span>
                        {d.dayNum}
                        <sup className="text-[9px] ml-[1px]">{d.suffix}</sup>{" "}
                        {d.monthYear}
                      </span>
                    );
                  })()}
                </div>
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  {fmtKickoffTime(fixture.kickoff)}
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="flex flex-col items-center text-center min-w-0">
                <TeamBadge
                  name={fixture.home.name}
                  shortName={fixture.home.shortName}
                  badge={fixture.home.badge}
                />
                <div className="mt-1 text-xs font-semibold text-foreground truncate w-full">
                  {fixture.home.shortName || fixture.home.name}
                </div>
              </div>
              <div className="text-xs text-muted uppercase">vs</div>
              <div className="flex flex-col items-center text-center min-w-0">
                <TeamBadge
                  name={fixture.away.name}
                  shortName={fixture.away.shortName}
                  badge={fixture.away.badge}
                />
                <div className="mt-1 text-xs font-semibold text-foreground truncate w-full">
                  {fixture.away.shortName || fixture.away.name}
                </div>
              </div>
              </div>
            </div>
          )}

          <div className="mt-3 text-sm text-center">
            <div className="font-semibold mb-2 text-foreground">
              Taken scores
            </div>

            {takenScores.length === 0 ? (
              <div className="text-muted">None yet</div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {takenScores.map((s) => (
                  <span
                    key={s}
                    className="text-xs bg-surface border border-teal-500 rounded-full px-2 py-1 text-foreground"
                  >
                    {s.replace("-", "–")}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {err && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {err}
          </div>
        )}

        {/* your turn or waiting */}
        {amITurn ? (
          <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
            <div className="font-semibold text-foreground">Your turn</div>

            <div className="flex items-center justify-center gap-3">
              <input
                value={homeScore}
                onChange={(e) =>
                  onlyDigitsOrEmpty(e.target.value) &&
                  setHomeScore(e.target.value)
                }
                className="w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0"
                inputMode="numeric"
              />
              <span className="text-2xl text-muted">-</span>
              <input
                value={awayScore}
                onChange={(e) =>
                  onlyDigitsOrEmpty(e.target.value) &&
                  setAwayScore(e.target.value)
                }
                className="w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0"
                inputMode="numeric"
              />
            </div>

            <button
              disabled={submitting || isLocked}
              onClick={submitPick}
              className={`w-full rounded-lg px-4 py-3 bg-accent text-accent-foreground disabled:opacity-60 ${BTN_3D}`}
            >
              {submitting ? "Submitting…" : "Confirm score"}
            </button>
          </div>
        ) : (
          <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground">
            Waiting for {currentTurnName} to pick…
          </div>
        )}
      </div>
    </div>
  );
}
