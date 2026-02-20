"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import {
  fixtureDayKey,
  fixtureDayLabel,
  formatDateWithOrdinal,
} from "@/lib/dateDisplay";
import { collection, doc, onSnapshot, query } from "firebase/firestore";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  players: string[];
  fixtureIds: number[];
  lockAt?: unknown;
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
const BTN_3D = "btn-3d-accent";

export default function GoldenPage() {
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

  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [myPicksByFixture, setMyPicksByFixture] = useState<
    Record<number, string>
  >({});

  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(
    null,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compactOtherPicks, setCompactOtherPicks] = useState(false);

  const routedRef = useRef(false);

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
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("goldenCompactOtherPicks");
    setCompactOtherPicks(raw === "1");
  }, []);

  // listen to game doc (for state + players + fixtureIds + auto route)
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

        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
          return;
        }

        if (st === "REVEAL") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/reveal`);
          return;
        }
        if (st === "LOBBY") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame`);
          return;
        }
      },
      () => setError("Failed to load game state."),
    );

    return () => unsub();
  }, [user, roomCode, gw, router, seasonKey]);

  // load fixtures for GW
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

  // listen to ALL picks for this GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;

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
    );

    return onSnapshot(
      picksQ,
      (snap) => {
        const list: PickDoc[] = snap.docs.map((d) => d.data() as PickDoc);
        setAllPicks(list);

        if (user) {
          const mine: Record<number, string> = {};
          for (const p of list) {
            if (p.uid === user.uid) mine[p.fixtureId] = p.score;
          }
          setMyPicksByFixture(mine);

          if (selectedFixtureId == null) {
            const first = Object.keys(mine)[0];
            if (first) setSelectedFixtureId(Number(first));
          }
        }
      },
      () => setError("Failed to listen for picks."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, gw, user?.uid, seasonKey]);

  // listen to golden locks
  useEffect(() => {
    if (gw == null || !seasonKey) return;

    const goldenQ = query(
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
      goldenQ,
      (snap) => {
        const map: Record<string, GoldenDoc> = {};
        for (const d of snap.docs) {
          map[d.id] = d.data() as GoldenDoc;
        }
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for golden locks."),
    );
  }, [roomCode, gw, seasonKey]);

  const playersCount = game?.players?.length ?? 0;
  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const myGolden = user ? goldensByUid[user.uid] : undefined;
  const myGoldenLocked = !!myGolden?.locked;

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByFixture = useMemo(() => {
    const m = new Map<number, PickDoc[]>();
    for (const p of allPicks) {
      if (!m.has(p.fixtureId)) m.set(p.fixtureId, []);
      m.get(p.fixtureId)!.push(p);
    }
    return m;
  }, [allPicks]);

  async function lockGolden() {
    if (!user) return;
    if (gw == null) return;

    if (selectedFixtureId == null) {
      setError("Select a fixture to make golden.");
      return;
    }

    const score = myPicksByFixture[selectedFixtureId];
    if (!score) {
      setError("You can only choose golden from a fixture you picked.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/game/golden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw,
          uid: user.uid,
          fixtureId: selectedFixtureId,
          score,
          seasonKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to lock golden.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to lock golden.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleCompactOtherPicks() {
    setCompactOtherPicks((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("goldenCompactOtherPicks", next ? "1" : "0");
      }
      return next;
    });
  }

  if (loading || !user) return null;
  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Loading golden…</div>
      </div>
    );
  }

  if (String(game.state).toUpperCase() !== "GOLDEN") {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 border border-teal-500">
          <div className="text-lg font-semibold text-foreground">
            Not in Golden phase
          </div>
          <div className="text-sm text-muted mt-1">
            Current state: {game.state}
          </div>
        </div>
      </div>
    );
  }

  const orderedFixtureIds = game.fixtureIds?.length
    ? game.fixtureIds
    : fixtures.map((f) => f.fixtureId);
  const dayBoundaryByIdx = (() => {
    const firstIdxByDay = new Map<string, number>();
    const lastIdxByDay = new Map<string, number>();
    orderedFixtureIds.forEach((fid, idx) => {
      const fixture = fixtureMap.get(fid);
      const dayKey = fixtureDayKey(fixture?.kickoff || "");
      if (!firstIdxByDay.has(dayKey)) firstIdxByDay.set(dayKey, idx);
      lastIdxByDay.set(dayKey, idx);
    });
    return orderedFixtureIds.map((fid, idx) => {
      const fixture = fixtureMap.get(fid);
      const dayKey = fixtureDayKey(fixture?.kickoff || "");
      return {
        showDayHeader: firstIdxByDay.get(dayKey) === idx,
        showDayFooter: lastIdxByDay.get(dayKey) === idx,
        dayLabel: fixtureDayLabel(fixture?.kickoff || ""),
      };
    });
  })();
  const isLocked = false;

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Golden Pick Selection
            </h1>
            <div className="font-display text-sm text-muted">
              {roomCode} • GW {gw}
            </div>
            <div className="text-xs text-muted">
              Locked: {lockedCount} / {playersCount}
            </div>
          </div>

        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {/* If locked, show waiting room */}
        {myGoldenLocked ? (
          <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
            <div className="font-semibold text-foreground">
              You’re locked in ✅
            </div>
            <div className="text-sm text-muted mt-1">
              Golden fixture:{" "}
              <span className="font-semibold text-foreground">
                {myGolden.fixtureId} ({String(myGolden.score).replace("-", "–")}
                )
              </span>
            </div>

            <div className="mt-4 w-full h-2 bg-surface border border-teal-500 rounded">
              <div
                className="h-2 bg-accent rounded"
                style={{
                  width:
                    playersCount > 0
                      ? `${Math.round((lockedCount / playersCount) * 100)}%`
                      : "0%",
                }}
              />
            </div>
            <div className="text-xs text-muted mt-2">
              Waiting for others to lock their golden pick…
            </div>
          </div>
        ) : (
          <>
            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
              <div className="font-semibold mb-2 text-foreground">
                Choose your Golden fixture
              </div>
              <div className="text-sm text-muted">
                Your golden doubles points:
                <ul className="list-disc pl-5 mt-1">
                  <li>
                    Correct result = <b className="text-foreground">2 points</b>
                  </li>
                  <li>
                    Correct score = <b className="text-foreground">4 points</b>
                  </li>
                  <li>
                    Otherwise = <b className="text-foreground">0</b>
                  </li>
                </ul>
              </div>
            </div>

	            <div>
              <SpecialBreak />
	              <div className="mb-3 flex items-center justify-end">
	                <label className="inline-flex items-center gap-2 text-xs text-foreground select-none">
	                  <span>Compact Other Picks</span>
	                  <button
	                    type="button"
	                    role="switch"
	                    aria-checked={compactOtherPicks}
	                    onClick={toggleCompactOtherPicks}
	                    className={[
	                      `relative h-6 w-11 rounded-full border transition-colors ${BTN_3D}`,
	                      compactOtherPicks
	                        ? "bg-yellow-500/20 border-yellow-400/80"
	                        : "bg-surface border-subtle",
	                    ].join(" ")}
	                  >
	                    <span
	                      className={[
	                        "absolute top-0.5 h-4 w-4 rounded-full bg-foreground transition-all",
	                        compactOtherPicks ? "left-6" : "left-0.5",
	                      ].join(" ")}
	                    />
	                  </button>
	                </label>
	              </div>
	              <div className="flex flex-wrap justify-center gap-3 sm:gap-4 items-start">
	              {orderedFixtureIds.map((fid, idx) => {
	                const f = fixtureMap.get(fid);
	                const myScore = myPicksByFixture[fid];
	                const kickoff = f ? new Date(f.kickoff) : null;
	                const kickoffDate = f ? formatDateWithOrdinal(f.kickoff) : null;
	                const kickoffTime = kickoff
	                  ? kickoff.toLocaleTimeString("en-GB", {
	                      hour: "2-digit",
	                      minute: "2-digit",
	                      hour12: false,
	                    })
	                  : "";

	                const others = (picksByFixture.get(fid) ?? [])
	                  .filter((p) => p.uid !== user.uid)
	                  .map((p) => p.score);
                  const dayBoundary = dayBoundaryByIdx[idx];
                  const showDayHeader = !!dayBoundary?.showDayHeader;
                  const showDayFooter = !!dayBoundary?.showDayFooter;
                  const dayLabel = dayBoundary?.dayLabel || "";

                const isSelected = selectedFixtureId === fid;

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
	                  <button
	                    type="button"
	                    onClick={() => setSelectedFixtureId(fid)}
	                    disabled={!myScore}
	                    className={[
	                      "no-3d w-full text-left rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border p-[clamp(0.75rem,1.1vw,1.25rem)] transition-all duration-200 page-action-btn",
	                      isSelected
	                        ? "golden-selected border-yellow-400/90 bg-gradient-to-b from-yellow-500/15 to-amber-400/5 shadow-[0_10px_22px_rgba(250,204,21,0.20)] scale-[1.02] origin-center"
	                        : "border-teal-500 bg-surface-2",
	                      !myScore
	                        ? "opacity-60 cursor-not-allowed"
	                        : "hover:bg-surface",
	                    ].join(" ")}
	                  >
	                    <div className="space-y-2">
	                      <div className="text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted mb-1">
	                        <div className="flex items-center justify-between gap-2">
	                          <span className="font-display font-semibold">
	                            {kickoffDate ? (
	                              <>
	                                {kickoffDate.day}
	                                <span
	                                  className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold"
	                                  aria-hidden="true"
	                                >
	                                  {kickoffDate.suffix}
	                                </span>{" "}
	                                {kickoffDate.monthYear}
	                              </>
	                            ) : null}
	                          </span>
	                          <span className="font-display font-semibold tabular-nums">{kickoffTime}</span>
	                        </div>
	                      </div>
	                      <div>
	                        {f ? (
                            <>
                              <div className="sm:hidden space-y-1">
                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                  <div className="flex justify-center">
                                    <TeamBadge
                                      name={f.home.name}
                                      tla={f.home.tla}
                                      shortName={f.home.shortName}
                                      badge={f.home.badge}
                                    />
                                  </div>
                                  <span className="font-display text-[10px] sm:text-[11px] font-semibold text-muted uppercase inline-flex items-center justify-center">
                                    vs
                                  </span>
                                  <div className="flex justify-center">
                                    <TeamBadge
                                      name={f.away.name}
                                      tla={f.away.tla}
                                      shortName={f.away.shortName}
                                      badge={f.away.badge}
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
                                    tla={f.home.tla}
                                    shortName={f.home.shortName}
                                    badge={f.home.badge}
                                  />
                                  <TeamLabel
                                    name={f.home.name}
                                    tla={f.home.tla}
                                    shortName={f.home.shortName}
                                    wrapperClassName="w-full"
                                    abbrClassName="font-display mt-1 text-[clamp(0.82rem,1.05vw,1.08rem)] font-semibold text-foreground w-full"
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
                                    tla={f.away.tla}
                                    shortName={f.away.shortName}
                                    badge={f.away.badge}
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
	                        ) : (
	                          <div className="font-semibold text-foreground">Fixture {fid}</div>
	                        )}
	                      </div>
	                      <div
	                        className={[
	                          "mt-2 rounded-lg border px-3 py-2 text-center transition-all duration-200",
	                          isSelected
	                            ? "border-yellow-300/90 bg-gradient-to-r from-yellow-500/20 via-amber-300/8 to-yellow-500/20 shadow-[0_8px_18px_rgba(250,204,21,0.22)]"
	                            : "border-subtle bg-surface",
	                        ].join(" ")}
	                      >
	                        <div className="text-xs text-muted">Your pick</div>
	                        <div className="font-display text-lg font-semibold text-foreground tabular-nums">
	                          {myScore ? myScore.replace("-", " - ") : "—"}
	                        </div>
	                      </div>
	                    </div>

	                    <div className="mt-3">
	                      {!compactOtherPicks && (
	                        <div className="text-xs text-muted text-center">Other picks</div>
	                      )}
	                      {others.length === 0 ? (
	                        <div className={`text-xs text-muted text-center ${compactOtherPicks ? "" : "mt-1"}`}>
	                          None
	                        </div>
	                      ) : compactOtherPicks ? (
	                        <div className="text-xs text-muted text-center">
	                        </div>
	                      ) : (
	                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
	                          {others.slice(0, 10).map((score, idx) => (
	                            <span
	                              key={`${fid}-other-${idx}-${score}`}
	                              className="font-display rounded-full border border-subtle px-2.5 py-1 text-xs text-foreground tabular-nums"
	                            >
	                              {String(score).replace("-", " - ")}
	                            </span>
	                          ))}
	                        </div>
	                      )}
	                    </div>

                    {!myScore && (
                      <div className="mt-2 text-xs text-danger">
                        You didn’t pick this fixture (can’t be golden).
                      </div>
                    )}
	                  </button>
                  </div>
	                );
	              })}
	              </div>
	            </div>

            <button
              onClick={lockGolden}
              disabled={
                submitting ||
                isLocked ||
                selectedFixtureId == null ||
                !myPicksByFixture[selectedFixtureId]
              }
              className={`w-full rounded-xl py-4 bg-accent text-accent-foreground disabled:opacity-60 ${BTN_3D}`}
            >
              {submitting ? "Locking…" : "Lock Golden Pick"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
