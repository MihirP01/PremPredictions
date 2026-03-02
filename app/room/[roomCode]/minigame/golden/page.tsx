"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { getRoomBootstrapCached, patchRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import {
  subscribeRoomGameDoc,
  subscribeRoomGoldens,
  subscribeRoomMeta,
  subscribeRoomPicks,
} from "@/lib/liveGameBus";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "POWERUPS" | "REVEAL";
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
const TEAM_COLOR_BY_TLA: Record<string, string> = {
  ARS: "#ef4444",
  AVL: "#7c3aed",
  BHA: "#3b82f6",
  BOU: "#ef4444",
  BRE: "#dc2626",
  CHE: "#2563eb",
  CRY: "#1d4ed8",
  EVE: "#1e3a8a",
  FUL: "#f3f4f6",
  IPS: "#1d4ed8",
  LEI: "#1d4ed8",
  LIV: "#dc2626",
  MCI: "#38bdf8",
  MUN: "#dc2626",
  NEW: "#94a3b8",
  NFO: "#dc2626",
  SOU: "#ef4444",
  TOT: "#f8fafc",
  WHU: "#7c3aed",
  WOL: "#f59e0b",
  SUN: "#ef4444",
  BUR: "#7c3aed",
  LEE: "#f8fafc",
};

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : normalized.padEnd(6, "0");
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function colorForTeam(tla?: string | null, shortName?: string | null, name?: string | null) {
  const key = String(tla || shortName || name || "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
  return TEAM_COLOR_BY_TLA[key] || "#475569";
}

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
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState(false);

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, user, router]);

  // current GW
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
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("goldenCompactOtherPicks");
    setCompactOtherPicks(raw === "1");
  }, []);

  // listen to game doc (for state + players + fixtureIds + auto route)
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
  }, [roomCode, gw, seasonKey]);

  // listen to game doc (for state + players + fixtureIds + auto route)
  useEffect(() => {
    if (!user || gw == null || !seasonKey) return;
    const unsub = subscribeRoomGameDoc(
      roomCode,
      seasonKey,
      gw,
      (data) => {
        const gameData = (data as GameDoc | null) ?? null;
        setGame(gameData);

        const st = String(gameData?.state ?? "")
          .trim()
          .toUpperCase();
        if (st) patchRoomBootstrapCached(roomCode, { gameState: st });
        if (st === "GOLDEN" || !st) return;
        if (st === "DRAFT") {
          router.replace(`/room/${roomCode}/minigame/play`);
          return;
        }
        if (st === "REVEAL") {
          router.replace(`/room/${roomCode}/minigame/reveal`);
          return;
        }
        if (st === "POWERUPS") {
          router.replace(`/room/${roomCode}/minigame/powerups`);
          return;
        }
        if (st === "LOBBY") {
          router.replace(`/room/${roomCode}/minigame`);
          return;
        }
      },
      () => setError("Failed to load game state."),
    );

    return unsub;
  }, [user, roomCode, gw, router, seasonKey]);

  // load fixtures for GW
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

  // listen to ALL picks for this GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const data = await getGameDataCached(roomCode, seasonKey, gw);
      if (cancelled) return;
      const list: PickDoc[] = data.picks.map((p) => ({
        uid: p.uid,
        fixtureId: p.fixtureId,
        score: p.score,
      }));
      const map: Record<string, GoldenDoc> = {};
      for (const g of data.goldens) {
        map[g.uid] = {
          uid: g.uid,
          fixtureId: g.fixtureId,
          score: g.score,
          locked: g.locked,
        };
      }
      setAllPicks(list);
      setGoldensByUid(map);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gw, roomCode, seasonKey]);

  // listen to ALL picks for this GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPicks(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const picks = list as PickDoc[];
        setAllPicks(picks);

        if (user) {
          const mine: Record<number, string> = {};
          for (const p of picks) {
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
      () => setError("Failed to listen for golden locks."),
    );
  }, [roomCode, gw, seasonKey]);

  // hide/show other picks based on room setting
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

  const playersCount = game?.players?.length ?? 0;
  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);
  const lockedProgressPct =
    playersCount > 0 ? Math.round((lockedCount / playersCount) * 100) : 0;

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
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

        <div className="text-sm text-muted inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading golden…</span>
        </div>
      </div>
    );
  }

  if (String(game.state).toUpperCase() !== "GOLDEN") {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

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
  const isLocked = false;

  return (
    <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-subtle shadow-[0_10px_28px_rgba(250,204,21,0.10)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">
              Golden Pick Selection
            </h1>
            <div className="font-display text-sm text-muted">
              {roomCode} • GW {gw}
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
          <div className="border border-yellow-300/70 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-4 bg-[linear-gradient(180deg,rgba(250,204,21,0.14)_0%,rgba(250,204,21,0.06)_100%)] shadow-[0_10px_24px_rgba(250,204,21,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-foreground">Locked In</div>
                <div className="text-xs text-muted mt-0.5">Your golden pick is saved.</div>
              </div>
              <span className="font-display rounded-full border border-yellow-300/70 bg-yellow-400/20 px-2.5 py-1 text-xs font-semibold text-foreground">
                Golden
              </span>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="rounded-lg border border-subtle bg-surface/80 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Fixture</div>
                {(() => {
                  const lockedFixture = fixtureMap.get(myGolden.fixtureId);
                  if (!lockedFixture) {
                    return (
                      <div className="font-display text-sm font-semibold text-foreground">
                        #{myGolden.fixtureId}
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
              <div className="rounded-lg border border-yellow-300/70 bg-[linear-gradient(135deg,rgba(168,85,247,0.16)_0%,rgba(250,204,21,0.18)_100%)] px-3 py-2 text-center">
                <div className="text-[11px] uppercase tracking-wide text-muted">Pick</div>
                <div className="font-display text-base font-semibold text-foreground tabular-nums">
                  {String(myGolden.score).replace("-", " - ")}
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
              <div className="w-full h-2 rounded-full bg-surface border border-yellow-300/60 overflow-hidden">
                <div
                  className="h-full bg-[linear-gradient(90deg,rgba(250,204,21,0.95)_0%,rgba(45,212,191,0.9)_100%)] transition-all duration-500"
                  style={{
                    width:
                      playersCount > 0
                        ? `${Math.round((lockedCount / playersCount) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted mt-2 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Waiting for others to lock in…</span>
            </div>
          </div>
        ) : (
          <>
            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
              <div className="font-semibold mb-2 text-foreground">
                Choose your Golden fixture
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(98px,1fr))] gap-2">
                <div className="key-chip key-chip-result rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border border-yellow-300/70 bg-emerald-500/20 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.35)]">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Correct Result</div>
                  <div className="font-display text-base font-semibold text-foreground">+2 pts</div>
                </div>
                <div className="key-chip key-chip-exact rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border border-yellow-300/70 bg-purple-500/20 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.35)]">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Exact Score</div>
                  <div className="font-display text-base font-semibold text-foreground">+4 pts</div>
                </div>
                <div className="rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border border-yellow-300/70 bg-transparent px-3 py-2 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.35)]">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Miss</div>
                  <div className="font-display text-base font-semibold text-foreground">0 pts</div>
                </div>
              </div>
            </div>

	            <div>
              <SpecialBreak className="mb-3" />
                {!allowIdenticalPicks && (
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
                )}
	              <div className="grid items-start gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
	              {orderedFixtureIds.map((fid, idx) => {
	                const f = fixtureMap.get(fid);
	                const myScore = myPicksByFixture[fid];
	                const others = (picksByFixture.get(fid) ?? [])
	                  .filter((p) => p.uid !== user.uid)
	                  .map((p) => p.score);

                const isSelected = selectedFixtureId === fid;
                const homeColor = colorForTeam(f?.home.tla, f?.home.shortName, f?.home.name);
                const awayColor = colorForTeam(f?.away.tla, f?.away.shortName, f?.away.name);
                const clashBgStyle: React.CSSProperties = {
                  backgroundImage: `linear-gradient(120deg, ${hexToRgba(homeColor, isSelected ? 0.32 : 0.22)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(awayColor, isSelected ? 0.32 : 0.22)} 100%)`,
                };

                return (
                  <div
                    key={fid}
                    className="fixture-card-enter space-y-2 w-full"
                    style={{
                      animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                      animationDuration: "520ms",
                    }}
                  >
	                  <button
	                    type="button"
	                    onClick={() => setSelectedFixtureId(fid)}
	                    disabled={!myScore}
	                    className={[
	                      "fixture-clash-bg no-3d w-full text-left rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border p-[clamp(0.75rem,1.1vw,1.25rem)] transition-all duration-200 page-action-btn",
	                      isSelected
	                        ? "golden-selected border-yellow-300/65 ring-1 ring-inset ring-yellow-300/75 shadow-[0_10px_22px_rgba(250,204,21,0.20),0_0_0_1px_rgba(253,224,71,0.26)] scale-[1.02] origin-center"
	                        : "border-white/15",
	                      !myScore
	                        ? "opacity-60 cursor-not-allowed"
	                        : "",
	                    ].join(" ")}
                      style={clashBgStyle}
	                  >
	                    <div className="space-y-2">
	                      <div>
	                        {f ? (
                            <>
                              <div className="sm:hidden">
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
                                      showFullName={false}
                                      wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                                      abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
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
                                      showFullName={false}
                                      wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                                      abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                                      fullNameWindowPx={68}
                                    />
                                  </div>
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
                                    showFullName={false}
                                    wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                                    abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                                    fullNameWindowPx={88}
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
                                    showFullName={false}
                                    wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                                    abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                                    fullNameWindowPx={88}
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

                      {!allowIdenticalPicks && (
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
	                              className="font-display rounded-full border border-subtle px-2.5 py-1 text-xs text-foreground tabular-nums whitespace-nowrap"
	                            >
	                              {String(score).replace("-", " - ")}
	                            </span>
	                          ))}
	                        </div>
	                      )}
	                    </div>
                      )}

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
            <SpecialBreak className="my-3" />
            <div className="w-full rounded-xl border border-yellow-300/65 bg-[linear-gradient(180deg,rgba(250,204,21,0.2)_0%,rgba(250,204,21,0.07)_100%)] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-display inline-flex items-center rounded-full border border-yellow-300/70 bg-yellow-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground">
                  Room Lock-In
                </span>
                <span className="font-display text-xs font-semibold tabular-nums text-yellow-200">
                  {lockedProgressPct}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full border border-yellow-300/60 bg-surface/80">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,rgba(250,204,21,0.6),rgba(251,191,36,0.98))] shadow-[0_0_14px_rgba(250,204,21,0.38)] transition-all duration-500"
                  style={{ width: `${lockedProgressPct}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-muted">
                <span className="font-display text-foreground">{lockedCount}</span>
                <span> of </span>
                <span className="font-display text-foreground">{playersCount || 0}</span>
                <span> players locked</span>
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
              className={`w-full rounded-xl py-5 text-lg font-semibold border border-yellow-300/75 bg-[linear-gradient(180deg,rgba(250,204,21,0.22)_0%,rgba(250,204,21,0.08)_100%)] text-foreground shadow-[0_10px_24px_rgba(250,204,21,0.22)] hover:bg-[linear-gradient(180deg,rgba(250,204,21,0.28)_0%,rgba(250,204,21,0.12)_100%)] disabled:opacity-60 ${BTN_3D}`}
            >
              {submitting ? "Locking…" : "Lock-In"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
