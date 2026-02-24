"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import {
  subscribeRoomGameDoc,
  subscribeRoomGoldens,
  subscribeRoomMeta,
  subscribeRoomPicks,
  subscribeRoomPowerups,
} from "@/lib/liveGameBus";
import {
  fixtureDayKey,
  fixtureDayLabel,
  formatDateWithOrdinal,
} from "@/lib/dateDisplay";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "POWERUPS" | "REVEAL";
  players: string[];
  fixtureIds: number[];
  powerupsEnabled?: boolean;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
};

type PickDoc = {
  uid: string;
  fixtureId: number;
  score: string;
};

type PowerupDoc = {
  uid: string;
  fixtureId: number;
  powerupType: "DOUBLE";
  locked: boolean;
};

type GoldenDoc = {
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
};

const BTN_3D = "btn-3d-accent";

export default function PowerupsPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [myPicksByFixture, setMyPicksByFixture] = useState<Record<number, string>>({});
  const [powerupsByUid, setPowerupsByUid] = useState<Record<string, PowerupDoc>>({});
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>({});
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState(false);

  const routedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
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
  }, [roomCode]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const cached = await getRoomGameStateCached(roomCode, seasonKey, gw);
      if (!cancelled && cached) setGame(cached as GameDoc);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    if (!user || gw == null || !seasonKey) return;
    return subscribeRoomGameDoc(
      roomCode,
      seasonKey,
      gw,
      (data) => {
        const gameData = (data as GameDoc | null) ?? null;
        setGame(gameData);
        const st = String(gameData?.state || "").trim().toUpperCase();
        if (routedRef.current) return;
        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
        } else if (st === "GOLDEN") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/golden`);
        } else if (st === "REVEAL") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/reveal`);
        } else if (st === "LOBBY") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame`);
        }
      },
      () => setError("Failed to load game state."),
    );
  }, [gw, roomCode, router, seasonKey, user]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const d = await getFixturesCached(gw, seasonKey);
      const fx: Fixture[] = Array.isArray(d.fixtures) ? d.fixtures : [];
      if (!cancelled) setFixtures(fx);
    })().catch(() => !cancelled && setFixtures([]));
    return () => {
      cancelled = true;
    };
  }, [gw, seasonKey]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const data = await getGameDataCached(roomCode, seasonKey, gw);
      if (cancelled) return;
      setAllPicks(
        data.picks.map((p) => ({
          uid: p.uid,
          fixtureId: p.fixtureId,
          score: p.score,
        })),
      );
      const map: Record<string, PowerupDoc> = {};
      for (const p of data.powerups) {
        map[p.uid] = {
          uid: p.uid,
          fixtureId: p.fixtureId,
          powerupType: "DOUBLE",
          locked: p.locked,
        };
      }
      setPowerupsByUid(map);
      const goldenMap: Record<string, GoldenDoc> = {};
      for (const g of data.goldens) {
        goldenMap[g.uid] = {
          uid: g.uid,
          fixtureId: g.fixtureId,
          score: g.score,
          locked: g.locked,
        };
      }
      setGoldensByUid(goldenMap);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPicks(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const picks = list as PickDoc[];
        setAllPicks(picks);
        if (!user) return;
        const mine: Record<number, string> = {};
        for (const p of picks) {
          if (p.uid === user.uid) mine[p.fixtureId] = p.score;
        }
        setMyPicksByFixture(mine);
        setSelectedFixtureId((prev) => {
          if (prev != null && mine[prev]) return prev;
          const first = Object.keys(mine)[0];
          return first ? Number(first) : null;
        });
      },
      () => setError("Failed to listen for picks."),
    );
  }, [gw, roomCode, seasonKey, user]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPowerups(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const map: Record<string, PowerupDoc> = {};
        for (const p of list) {
          map[p.uid] = {
            uid: p.uid,
            fixtureId: p.fixtureId,
            powerupType: "DOUBLE",
            locked: p.locked,
          };
        }
        setPowerupsByUid(map);
      },
      () => setError("Failed to listen for power-ups."),
    );
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomGoldens(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const map: Record<string, GoldenDoc> = {};
        for (const g of list) {
          map[g.uid] = {
            uid: g.uid,
            fixtureId: g.fixtureId,
            score: g.score,
            locked: g.locked,
          };
        }
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for goldens."),
    );
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => {
        if (!roomMeta) return;
        const style = roomMeta.settings.gameModeStyle;
        const allow = style === "sprint" ? true : !roomMeta.settings.sameResultLock;
        setAllowIdenticalPicks(allow);
      },
      () => {},
    );
  }, [roomCode]);

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByFixture = useMemo(() => {
    const m = new Map<number, PickDoc[]>();
    for (const p of allPicks) {
      if (!m.has(p.fixtureId)) m.set(p.fixtureId, []);
      m.get(p.fixtureId)?.push(p);
    }
    return m;
  }, [allPicks]);

  const playersCount = game?.players?.length ?? 0;
  const lockedCount = useMemo(
    () => Object.values(powerupsByUid).filter((p) => p.locked).length,
    [powerupsByUid],
  );

  const myPowerup = user ? powerupsByUid[user.uid] : undefined;
  const myPowerupLocked = !!myPowerup?.locked;
  const myGoldenFixtureId = user ? goldensByUid[user.uid]?.fixtureId ?? null : null;

  useEffect(() => {
    setSelectedFixtureId((prev) => {
      if (prev != null && prev !== myGoldenFixtureId && myPicksByFixture[prev]) return prev;
      const next = Object.keys(myPicksByFixture)
        .map((v) => Number(v))
        .find((fid) => Number.isFinite(fid) && fid !== myGoldenFixtureId);
      return typeof next === "number" ? next : null;
    });
  }, [myGoldenFixtureId, myPicksByFixture]);

  async function lockPowerup() {
    if (!user || gw == null || selectedFixtureId == null) return;
    if (!myPicksByFixture[selectedFixtureId]) {
      setError("You can only place Double Points on your own pick.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/game/powerup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw,
          uid: user.uid,
          fixtureId: selectedFixtureId,
          powerupType: "DOUBLE",
          seasonKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to lock power-up.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to lock power-up.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;
  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
        <div className="text-sm text-muted">Loading power-ups…</div>
      </div>
    );
  }

  if (String(game.state).toUpperCase() !== "POWERUPS") {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
        <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 border border-teal-500">
          <div className="text-lg font-semibold text-foreground">Not in Power-Ups phase</div>
          <div className="text-sm text-muted mt-1">Current state: {game.state}</div>
        </div>
      </div>
    );
  }

  const orderedFixtureIds = game.fixtureIds?.length ? game.fixtureIds : fixtures.map((f) => f.fixtureId);
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

  return (
    <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Power-Ups</h1>
          <div className="font-display text-sm text-muted">
            {roomCode} • GW {gw}
          </div>
          <div className="text-xs text-muted">Locked: {lockedCount} / {playersCount}</div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {myPowerupLocked ? (
          <div className="border border-red-400/75 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-4 bg-[linear-gradient(180deg,rgba(239,68,68,0.14)_0%,rgba(239,68,68,0.05)_100%)] shadow-[0_10px_24px_rgba(239,68,68,0.16)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-foreground">Locked In</div>
                <div className="text-xs text-muted mt-0.5">Your power-up is saved.</div>
              </div>
              <span className="font-display rounded-full border border-red-300/75 bg-red-400/20 px-2.5 py-1 text-xs font-semibold text-foreground">
                Double Points
              </span>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="rounded-lg border border-subtle bg-surface/80 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Fixture</div>
                {(() => {
                  const lockedFixture = fixtureMap.get(myPowerup.fixtureId);
                  if (!lockedFixture) {
                    return (
                      <div className="font-display text-sm font-semibold text-foreground">
                        #{myPowerup.fixtureId}
                      </div>
                    );
                  }
                  return (
                    <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                      <div className="font-display text-xs font-semibold text-foreground truncate text-left">
                        {lockedFixture.home.tla || lockedFixture.home.shortName || lockedFixture.home.name}
                      </div>
                      <span className="font-display text-[10px] uppercase text-muted">vs</span>
                      <div className="font-display text-xs font-semibold text-foreground truncate text-right">
                        {lockedFixture.away.tla || lockedFixture.away.shortName || lockedFixture.away.name}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="rounded-lg border border-red-300/70 bg-[linear-gradient(135deg,rgba(239,68,68,0.18)_0%,rgba(45,212,191,0.14)_100%)] px-3 py-2 text-center">
                <div className="text-[11px] uppercase tracking-wide text-muted">Pick</div>
                <div className="font-display text-base font-semibold text-foreground tabular-nums">
                  {String(myPicksByFixture[myPowerup.fixtureId] || "—").replace("-", " - ")}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span>Lobby lock progress</span>
                <span className="font-display text-foreground">
                  {lockedCount}/{playersCount || 0}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-surface border border-red-300/60 overflow-hidden">
                <div
                  className="h-full bg-[linear-gradient(90deg,rgba(239,68,68,0.95)_0%,rgba(45,212,191,0.9)_100%)] transition-all duration-500"
                  style={{
                    width: playersCount > 0 ? `${Math.round((lockedCount / playersCount) * 100)}%` : "0%",
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted mt-2">Waiting for others to lock in…</div>
          </div>
        ) : (
          <>
            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 space-y-1">
              <div className="font-semibold text-foreground">Select Power-Up</div>
              <div className="rounded-lg border border-red-400/85 px-3 py-2 text-sm font-display text-foreground">
                Double Points
              </div>
              <div className="text-sm text-muted">
                Choose one fixture. If it scores 1/2/4, it becomes 2/4/8.
              </div>
            </div>

            <SpecialBreak />
            <div className="grid items-start gap-3 sm:gap-4 grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {orderedFixtureIds.map((fid, idx) => {
                const f = fixtureMap.get(fid);
                const myScore = myPicksByFixture[fid];
                const kickoffDate = f ? formatDateWithOrdinal(f.kickoff) : null;
                const kickoffTime = f
                  ? new Date(f.kickoff).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "";
                const others = (picksByFixture.get(fid) ?? [])
                  .filter((p) => p.uid !== user.uid)
                  .map((p) => p.score);
                const dayBoundary = dayBoundaryByIdx[idx];
                const isSelected = selectedFixtureId === fid;
                const isGoldenFixture = myGoldenFixtureId != null && fid === myGoldenFixtureId;

                return (
                  <div key={fid} className="fixture-card-enter space-y-2 w-full">
                    <div className="h-5 sm:h-6 flex items-center justify-center">
                      {dayBoundary?.showDayHeader ? (
                        <div className="w-full flex items-center gap-2">
                          <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.08)_0%,rgba(var(--room-accent-rgb),0.45)_55%,rgba(var(--room-accent-rgb),0.08)_100%)]" />
                          <span className="font-display inline-flex items-center rounded-md border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-[linear-gradient(180deg,rgba(var(--room-accent-rgb),0.2)_0%,rgba(var(--room-accent-rgb),0.08)_100%)] px-2.5 py-[2px] text-[10px] sm:text-xs font-semibold leading-none text-muted uppercase tracking-wide shadow-[0_4px_12px_rgba(var(--room-accent-rgb),0.15)]">
                            {dayBoundary.dayLabel}
                          </span>
                          <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.08)_0%,rgba(var(--room-accent-rgb),0.45)_55%,rgba(var(--room-accent-rgb),0.08)_100%)]" />
                        </div>
                      ) : dayBoundary?.showDayFooter ? (
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
                      disabled={!myScore || isGoldenFixture}
                      className={[
                        "no-3d w-full text-left rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border p-[clamp(0.75rem,1.1vw,1.25rem)] transition-all duration-200 page-action-btn",
                        isSelected
                          ? "border-red-400/90 bg-[rgba(239,68,68,0.08)] scale-[1.02] origin-center"
                          : isGoldenFixture
                            ? "border-yellow-300/70 bg-[linear-gradient(135deg,rgba(250,204,21,0.16)_0%,rgba(250,204,21,0.05)_100%)]"
                          : "border-teal-500 bg-surface-2",
                        !myScore || isGoldenFixture
                          ? "opacity-60 cursor-not-allowed"
                          : "hover:bg-surface",
                      ].join(" ")}
                    >
                      <div className="text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted mb-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display font-semibold">
                            {kickoffDate ? (
                              <>
                                {kickoffDate.dayNum}
                                <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                                  {kickoffDate.suffix}
                                </span>{" "}
                                {kickoffDate.monthYear}
                              </>
                            ) : null}
                          </span>
                          <span className="font-display font-semibold tabular-nums">{kickoffTime}</span>
                        </div>
                      </div>
                      {f ? (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
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
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                              fullNameClassName="font-display w-full text-[9px] text-muted leading-tight"
                              fullNameWindowPx={68}
                            />
                          </div>
                          <span className="font-display text-[10px] sm:text-[11px] font-semibold text-muted uppercase inline-flex items-center justify-center">
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
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                              fullNameClassName="font-display w-full text-[9px] text-muted leading-tight"
                              fullNameWindowPx={68}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="font-semibold text-foreground">Fixture {fid}</div>
                      )}
                      <div className="mt-2 rounded-lg border border-red-400/75 px-3 py-2 text-center">
                        {isGoldenFixture ? (
                          <div className="h-[46px] flex items-center justify-center">
                            <span className="font-display inline-flex items-center rounded-full border border-yellow-300/75 bg-yellow-400/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground">
                              Golden Locked
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="text-xs text-muted">Your pick</div>
                            <div className="font-display text-lg font-semibold text-foreground tabular-nums">
                              {myScore ? myScore.replace("-", " - ") : "—"}
                            </div>
                          </>
                        )}
                      </div>
                      {!allowIdenticalPicks && others.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                          {others.slice(0, 8).map((score, index) => (
                            <span
                              key={`${fid}-${index}-${score}`}
                              className="font-display rounded-full border border-subtle px-2 py-1 text-xs text-muted tabular-nums whitespace-nowrap"
                            >
                              {String(score).replace("-", " - ")}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {!myScore && (
                        <div className="mt-2 text-xs text-danger">
                          You didn’t pick this fixture (can’t apply power-up).
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={lockPowerup}
              disabled={
                submitting ||
                selectedFixtureId == null ||
                !myPicksByFixture[selectedFixtureId] ||
                (myGoldenFixtureId != null && selectedFixtureId === myGoldenFixtureId)
              }
              className={`w-full rounded-xl py-4 bg-accent text-accent-foreground disabled:opacity-60 ${BTN_3D}`}
            >
              {submitting ? "Locking…" : "Lock Double Points"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
