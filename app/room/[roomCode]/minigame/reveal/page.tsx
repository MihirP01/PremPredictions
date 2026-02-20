"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import PageBackButton from "../../../../../components/PageBackButton";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import {
  fixtureDayKey,
  fixtureDayLabel,
  formatKickoffParts,
  formatUnlockDateParts,
} from "@/lib/dateDisplay";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import { getCountdownParts } from "../lock-utils";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  players: string[];
  order?: string[];
  fixtureIds: number[];
  forcedReveal?: boolean;
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
  const [nowMs, setNowMs] = useState<number>(0);

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

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
  const dayBoundaryByIdx = useMemo(() => {
    const firstIdxByDay = new Map<string, number>();
    const lastIdxByDay = new Map<string, number>();
    fixtureIds.forEach((fid, idx) => {
      const fixture = fixtureMap.get(fid);
      const dayKey = fixtureDayKey(fixture?.kickoff || "");
      if (!firstIdxByDay.has(dayKey)) firstIdxByDay.set(dayKey, idx);
      lastIdxByDay.set(dayKey, idx);
    });
    return fixtureIds.map((fid, idx) => {
      const fixture = fixtureMap.get(fid);
      const dayKey = fixtureDayKey(fixture?.kickoff || "");
      return {
        showDayHeader: firstIdxByDay.get(dayKey) === idx,
        showDayFooter: lastIdxByDay.get(dayKey) === idx,
        dayLabel: fixtureDayLabel(fixture?.kickoff || ""),
      };
    });
  }, [fixtureIds, fixtureMap]);

  const picksByUserFixture = useMemo(() => {
    const m = new Map<string, string>(); // key = uid|fixtureId
    for (const p of picks)
      m.set(`${p.uid}|${p.fixtureId}`, String(p.score ?? "").trim());
    return m;
  }, [picks]);

  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const allLocked = !!game?.forcedReveal || (players.length > 0 && lockedCount >= players.length);
  const nextGw = gw != null ? gw + 1 : null;
  const unlockAtMs = useMemo(() => {
    if (!fixtures?.length) return null;
    const kickoffTimes = fixtures
      .map((f) => Date.parse(String(f.kickoff || "")))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!kickoffTimes.length) return null;
    const unlock = new Date(kickoffTimes[kickoffTimes.length - 1]);
    unlock.setDate(unlock.getDate() + 1);
    unlock.setHours(9, 0, 0, 0);
    return unlock.getTime();
  }, [fixtures]);
  const unlockMsLeft = unlockAtMs != null ? Math.max(unlockAtMs - nowMs, 0) : 0;
  const unlockCountdown = getCountdownParts(unlockMsLeft);
  const unlockTotalSec = Math.floor(unlockMsLeft / 1000);
  const unlockDayValue = Math.floor(unlockTotalSec / 86400);
  const unlockHourValue = Math.floor((unlockTotalSec % 86400) / 3600);
  const unlockMinuteValue = Math.floor((unlockTotalSec % 3600) / 60);
  const unlockSecondValue = unlockTotalSec % 60;
  const unlockCountdownRings = [
    {
      label: "Days",
      value: unlockCountdown.days,
      progress: unlockDayValue > 0 ? Math.min((unlockDayValue / 7) * 100, 100) : 0,
    },
    {
      label: "Hours",
      value: unlockCountdown.hours,
      progress: (unlockHourValue / 24) * 100,
    },
    {
      label: "Minutes",
      value: unlockCountdown.minutes,
      progress: (unlockMinuteValue / 60) * 100,
    },
    {
      label: "Seconds",
      value: unlockCountdown.seconds,
      progress: (unlockSecondValue / 60) * 100,
    },
  ];

  if (loading || !user) return null;

  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">
        <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Final Overview</h1>
              <div className="font-display text-sm text-muted">
                {roomCode} • GW {gw ?? "—"}
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-surface-2 border border-teal-500">
            <div className="text-sm text-muted">Loading reveal…</div>
          </div>
        </div>
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
              Final Overview
            </h1>
            <div className="font-display text-sm text-muted">
              {roomCode} • GW {gw}
            </div>
          </div>

          <div className="ml-auto flex gap-2 page-actions-enter">
            <PageBackButton
              label="Exit"
              className={BTN_3D}
              onClick={() => router.push(`/room/${roomCode}`)}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        <div className="border border-teal-500 rounded-xl p-3 bg-surface-2 space-y-1">
          <div className="text-xs text-muted">
            Next gameweek:{" "}
            <span className="font-display text-foreground">GW {nextGw ?? "—"}</span>
          </div>
          {unlockAtMs != null && (
            <>
              <div className="text-xs text-muted">
                Unlocks:{" "}
                <span className="font-display text-foreground">
                  {(() => {
                    const p = formatUnlockDateParts(unlockAtMs);
                    return (
                      <>
                        {p.day}
                        <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                          {p.suffix}
                        </span>{" "}
                        {p.monthYear} {p.time}
                      </>
                    );
                  })()}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {unlockCountdownRings.map((unit) => (
                  <div key={unit.label} className="flex flex-col items-center gap-2">
                    <div className="relative w-16 h-16 sm:w-[72px] sm:h-[72px]">
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
                          stroke="rgba(var(--room-accent-rgb), 0.2)"
                          strokeWidth="4"
                        />
                        <circle
                          cx="40"
                          cy="40"
                          r="34"
                          fill="none"
                          stroke="rgb(var(--room-accent-rgb))"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={213.63}
                          strokeDashoffset={
                            213.63 - (Math.max(Math.min(unit.progress, 100), 0) / 100) * 213.63
                          }
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="font-display text-lg sm:text-xl font-semibold text-foreground leading-none">
                          {unit.value}
                        </span>
                      </div>
                    </div>
                    <div className="font-display text-[11px] uppercase tracking-wide text-accent font-semibold">
                      {unit.label}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

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

        <SpecialBreak />
        <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
          {fixtureIds.map((fid, idx) => {
            const f = fixtureMap.get(fid);
            const actual = f?.result ? fmtScore(f.result) : "TBD";
            const kickoffParts = f ? formatKickoffParts(f.kickoff) : null;
            const dayBoundary = dayBoundaryByIdx[idx];
            const showDayHeader = !!dayBoundary?.showDayHeader;
            const showDayFooter = !!dayBoundary?.showDayFooter;
            const dayLabel = dayBoundary?.dayLabel || "";

            return (
              <div
                key={fid}
                className="fixture-card-enter space-y-2 w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.67rem)] xl:w-[calc(25%-0.75rem)]"
                style={{
                  animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                  animationDuration: "520ms",
                }}
              >
                <div className="h-5 sm:h-6 flex items-center justify-center">
                  {showDayHeader ? (
                    <div className="w-full flex items-center gap-2">
                      <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.08)_0%,rgba(var(--room-accent-rgb),0.45)_55%,rgba(var(--room-accent-rgb),0.08)_100%)]" />
                      <span className="font-display inline-flex items-center rounded-md border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-[linear-gradient(180deg,rgba(var(--room-accent-rgb),0.2)_0%,rgba(var(--room-accent-rgb),0.08)_100%)] px-2.5 py-[2px] text-[10px] sm:text-xs font-semibold leading-none text-muted uppercase tracking-wide shadow-[0_4px_12px_rgba(var(--room-accent-rgb),0.15)]">
                        {dayLabel}
                      </span>
                      <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.08)_0%,rgba(var(--room-accent-rgb),0.45)_55%,rgba(var(--room-accent-rgb),0.08)_100%)]" />
                    </div>
                  ) : showDayFooter ? (
                    <div className="w-full flex items-center justify-center gap-1.5">
                      <span className="h-px w-7 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.05)_0%,rgba(var(--room-accent-rgb),0.42)_100%)]" />
                      <span
                        className="h-1.5 w-1.5 rounded-full border border-[color:rgba(var(--room-accent-rgb),0.75)] bg-[color:rgba(var(--room-accent-rgb),0.55)]"
                        aria-hidden
                      />
                      <span className="h-px w-7 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.42)_0%,rgba(var(--room-accent-rgb),0.05)_100%)]" />
                    </div>
                  ) : (
                    <span aria-hidden className="invisible w-full">_</span>
                  )}
                </div>
                <div className="border border-teal-500 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-[clamp(0.75rem,1.1vw,1.25rem)] bg-surface-2">
                  <div className="space-y-2">
                  <div className="text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted mb-1">
                    {kickoffParts ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display font-semibold">
                          {kickoffParts.dayNum}
                          <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                            {kickoffParts.suffix}
                          </span>{" "}
                          {kickoffParts.monthYear}
                        </span>
                        <span className="font-display font-semibold tabular-nums">{kickoffParts.time}</span>
                      </div>
                    ) : (
                      <span>Fixture {fid}</span>
                    )}
                  </div>

                  {f && (
                    <>
                      <div className="sm:hidden space-y-1">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="flex justify-center">
                            <TeamBadge
                              name={f.home.name}
                              shortName={f.home.shortName}
                              badge={f.home.badge}
                              tla={f.home.tla}
                            />
                          </div>
                          <span className="font-display text-[10px] font-semibold text-muted uppercase inline-flex items-center justify-center">
                            vs
                          </span>
                          <div className="flex justify-center">
                            <TeamBadge
                              name={f.away.name}
                              shortName={f.away.shortName}
                              badge={f.away.badge}
                              tla={f.away.tla}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 justify-items-center">
                          <TeamLabel
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            wrapperClassName="flex w-[78px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                            fullNameClassName="font-display w-full text-[9px] text-muted leading-tight"
                            fullNameWindowPx={68}
                          />
                          <TeamLabel
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            wrapperClassName="flex w-[78px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                            fullNameClassName="font-display w-full text-[9px] text-muted leading-tight"
                            fullNameWindowPx={68}
                          />
                        </div>
                      </div>

                      <div className="hidden sm:grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.home.name}
                            shortName={f.home.shortName}
                            badge={f.home.badge}
                            tla={f.home.tla}
                          />
                          <TeamLabel
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            wrapperClassName="w-full"
                            abbrClassName="font-display mt-1 text-[clamp(0.82rem,1.05vw,1rem)] font-semibold text-foreground w-full"
                            fullNameClassName="font-display text-[10px] xl:text-[11px] text-muted w-full"
                            fullNameWindowPx={null}
                          />
                        </div>
                        <span className="font-display text-xs xl:text-sm font-semibold text-muted uppercase inline-flex items-center justify-center self-center h-full">
                          vs
                        </span>
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.away.name}
                            shortName={f.away.shortName}
                            badge={f.away.badge}
                            tla={f.away.tla}
                          />
                          <TeamLabel
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            wrapperClassName="w-full"
                            abbrClassName="font-display mt-1 text-[clamp(0.82rem,1.05vw,1.08rem)] font-semibold text-foreground w-full"
                            fullNameClassName="font-display text-[10px] xl:text-[11px] text-muted w-full"
                            fullNameWindowPx={null}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="text-center">
                    <div className="text-[clamp(0.85rem,1.1vw,1rem)] text-muted">Actual</div>
                    <div className="font-display text-[clamp(1rem,1.5vw,1.3rem)] font-semibold text-foreground tabular-nums">
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
                            <span className="font-display">{displayNamesByUid[uid] ?? uid.slice(0, 6)}</span>
                          </div>
                          <span
                            className={[
                              "font-display mt-1 inline-flex items-center justify-center rounded-full border border-subtle px-2.5 py-1 text-sm font-semibold text-foreground tabular-nums min-w-[58px]",
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
