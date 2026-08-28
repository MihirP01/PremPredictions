"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import PageShell from "../../../../../components/PageShell";
import SectionCard from "../../../../../components/SectionCard";
import SectionStack from "../../../../../components/SectionStack";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import TopActionRow from "../../../../../components/TopActionRow";
import {
  getRoomBootstrapCached,
  patchRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import {
  subscribeRoomGameDoc,
  subscribeRoomGoldens,
  subscribeRoomMeta,
  subscribeRoomPicks,
} from "@/lib/liveGameBus";
import { authenticatedFetch } from "@/lib/authenticatedFetch";

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
  home: {
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  away: {
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
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
const DESK_SHELL =
  "rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.012))] p-1 shadow-[0_22px_48px_rgba(4,10,22,0.18)]";
const DESK_INNER =
  "rounded-[26px] border border-white/6 bg-[linear-gradient(180deg,rgba(6,10,18,0.97),rgba(8,13,22,0.94))] px-4 py-4 sm:px-5 sm:py-5";
const PANEL_SHELL =
  "rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.026),rgba(255,255,255,0.012))] p-1 shadow-[0_18px_38px_rgba(4,10,22,0.14)]";
const PANEL_INNER =
  "rounded-[22px] border border-white/6 bg-[linear-gradient(180deg,rgba(6,10,18,0.96),rgba(7,11,20,0.93))] px-4 py-4 sm:px-5 sm:py-5";
const MINI_LABEL =
  "font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/40";
const SUMMARY_CARD =
  "rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-4 py-3";
const ACTION_BTN =
  "w-full rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(177,144,86,0.28),rgba(116,92,58,0.16))] px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.14em] text-foreground shadow-[0_16px_30px_rgba(6,12,24,0.2)] transition hover:border-white/14 hover:bg-[linear-gradient(135deg,rgba(196,160,98,0.34),rgba(128,102,62,0.2))] disabled:opacity-60 disabled:cursor-not-allowed";
const HEADER_STATUS_CARD =
  "min-w-[1px] rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,22,38,0.98),rgba(8,14,28,0.96))] px-4 py-3 text-right shadow-[0_16px_32px_rgba(4,8,16,0.32)]";
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

function colorForTeam(
  tla?: string | null,
  shortName?: string | null,
  name?: string | null,
) {
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
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const devPreview =
    process.env.NODE_ENV !== "production" &&
    searchParams.get("devPreview") === "1";
  const previewLocked = devPreview && searchParams.get("locked") === "1";

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
  const [compactOtherPicks, setCompactOtherPicks] = useState(true);
  const [showGoldenScoring, setShowGoldenScoring] = useState(false);
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState(false);

  const previewPlayerIds = useMemo(() => {
    if (!devPreview) return [];
    const self = user?.uid || "preview-self";
    return [self, "preview-rival-a", "preview-rival-b"];
  }, [devPreview, user?.uid]);
  const previewGame = useMemo<GameDoc | null>(() => {
    if (!devPreview || !fixtures?.length) return null;
    return {
      state: "GOLDEN",
      players: previewPlayerIds,
      fixtureIds: fixtures
        .slice(0, Math.min(10, fixtures.length))
        .map((f) => f.fixtureId),
    };
  }, [devPreview, fixtures, previewPlayerIds]);
  const previewPicks = useMemo<PickDoc[]>(() => {
    if (!devPreview || !previewGame) return [];
    const scoreCycle = ["2-1", "1-1", "3-2", "2-0", "0-0", "1-0"];
    return previewGame.fixtureIds.flatMap((fixtureId, fixtureIdx) =>
      previewPlayerIds.map((uid, playerIdx) => ({
        uid,
        fixtureId,
        score: scoreCycle[(fixtureIdx + playerIdx) % scoreCycle.length],
      })),
    );
  }, [devPreview, previewGame, previewPlayerIds]);
  const previewMyPicksByFixture = useMemo<Record<number, string>>(() => {
    if (!devPreview || !user) return {};
    const mine: Record<number, string> = {};
    for (const pick of previewPicks) {
      if (pick.uid === user.uid) mine[pick.fixtureId] = pick.score;
    }
    return mine;
  }, [devPreview, previewPicks, user]);
  const previewGoldensByUid = useMemo<Record<string, GoldenDoc>>(() => {
    if (!devPreview || !previewGame || !user) return {};
    const firstFixtureId = previewGame.fixtureIds[0];
    const firstScore = previewMyPicksByFixture[firstFixtureId] || "2-1";
    if (firstFixtureId == null) return {};
    if (!previewLocked) return {};
    const map: Record<string, GoldenDoc> = {
      [user.uid]: {
        uid: user.uid,
        fixtureId: firstFixtureId,
        score: firstScore,
        locked: true,
      },
    };
    map["preview-rival-a"] = {
      uid: "preview-rival-a",
      fixtureId: firstFixtureId,
      score: "1-1",
      locked: true,
    };
    return map;
  }, [devPreview, previewGame, previewLocked, previewMyPicksByFixture, user]);
  const previewGameActive =
    !!previewGame &&
    (!game || String(game.state || "").toUpperCase() !== "GOLDEN");
  const activeGame = previewGameActive ? previewGame : game;
  const activeAllPicks = previewGameActive ? previewPicks : allPicks;
  const activeMyPicksByFixture = previewGameActive
    ? previewMyPicksByFixture
    : myPicksByFixture;
  const activeGoldensByUid = previewGameActive
    ? previewGoldensByUid
    : goldensByUid;

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
        if (devPreview) return;
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
        const allow =
          style === "sprint" ? true : !roomMeta.settings.sameResultLock;
        setAllowIdenticalPicks(allow);
      },
      () => {},
    );
  }, [roomCode]);

  const playersCount = activeGame?.players?.length ?? 0;
  const lockedCount = useMemo(() => {
    return Object.values(activeGoldensByUid).filter((g) => g?.locked).length;
  }, [activeGoldensByUid]);

  const myGolden = user ? activeGoldensByUid[user.uid] : undefined;
  const myGoldenLocked = !!myGolden?.locked;

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByFixture = useMemo(() => {
    const m = new Map<number, PickDoc[]>();
    for (const p of activeAllPicks) {
      if (!m.has(p.fixtureId)) m.set(p.fixtureId, []);
      m.get(p.fixtureId)!.push(p);
    }
    return m;
  }, [activeAllPicks]);

  async function lockGolden() {
    if (!user) return;
    if (gw == null) return;
    if (previewGameActive) {
      setError("Preview mode only.");
      return;
    }

    if (selectedFixtureId == null) {
      setError("Select a fixture to make golden.");
      return;
    }

    const score = activeMyPicksByFixture[selectedFixtureId];
    if (!score) {
      setError("You can only choose golden from a fixture you picked.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await authenticatedFetch("/api/game/golden", {
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
        window.localStorage.setItem(
          "goldenCompactOtherPicks",
          next ? "1" : "0",
        );
      }
      return next;
    });
  }

  if (loading || !user) return null;
  if (gw == null || fixtures == null || !activeGame) {
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
        contentClassName="relative z-[1]"
      >
        <SectionStack gap="page">
          <SectionCard className={PANEL_SHELL}>
            <div className="text-sm text-muted inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading golden…</span>
            </div>
          </SectionCard>
        </SectionStack>
      </PageShell>
    );
  }

  if (String(activeGame.state).toUpperCase() !== "GOLDEN") {
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
        contentClassName="relative z-[1]"
      >
        <SectionStack gap="page">
          <SectionCard className={PANEL_SHELL}>
            <div className="text-lg font-semibold text-foreground">
              Not in Golden phase
            </div>
            <div className="text-sm text-muted mt-1">
              Current state: {activeGame.state}
            </div>
          </SectionCard>
        </SectionStack>
      </PageShell>
    );
  }

  const orderedFixtureIds = activeGame.fixtureIds?.length
    ? activeGame.fixtureIds
    : fixtures.map((f) => f.fixtureId);
  const isLocked = false;
  const selectableCount = orderedFixtureIds.filter(
    (fid) => !!activeMyPicksByFixture[fid],
  ).length;
  const selectionStatus = myGoldenLocked ? "Locked" : "Open";
  const selectedFixture =
    selectedFixtureId != null ? fixtureMap.get(selectedFixtureId) : null;
  const selectedFixtureScore =
    selectedFixtureId != null
      ? activeMyPicksByFixture[selectedFixtureId]
      : null;
  const lockedFixture = fixtureMap.get(myGolden?.fixtureId ?? -1);
  const lockedHomeColor = colorForTeam(
    lockedFixture?.home.tla,
    lockedFixture?.home.shortName,
    lockedFixture?.home.name,
  );
  const lockedAwayColor = colorForTeam(
    lockedFixture?.away.tla,
    lockedFixture?.away.shortName,
    lockedFixture?.away.name,
  );

  return (
    <PageShell
      width="wide"
      shellChrome={false}
      outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
      contentClassName="relative z-[1]"
    >
      <SectionStack gap="page">
        <TopActionRow
            title="Golden Pick"
            subtitle={`${roomCode} • GW ${gw}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
            frameActions={false}
            actions={
              <div className={HEADER_STATUS_CARD}>
                <div className={MINI_LABEL}>Locked</div>
                <div className="mt-1 font-display text-[1.55rem] font-semibold leading-none text-foreground tabular-nums">
                  {lockedCount}
                  <span className="ml-1 text-[0.9rem] font-medium text-muted">
                    of {playersCount || 0}
                  </span>
                </div>
              </div>
            }
          />

        {!myGoldenLocked ? (
          <SectionCard className={DESK_SHELL}>
            <div className={DESK_INNER}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className={MINI_LABEL}>Golden desk</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="font-display text-[clamp(1.5rem,4vw,2.6rem)] font-semibold tracking-tight text-foreground">
                      Golden selection
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className={MINI_LABEL}>Scoring key</div>
                  <button
                    type="button"
                    onClick={() => setShowGoldenScoring((prev) => !prev)}
                    className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/18 hover:text-foreground"
                  >
                    {showGoldenScoring ? "Collapse" : "Expand"}
                  </button>
                </div>
                <div
                  className={[
                    "grid overflow-hidden transition-[max-height,opacity] duration-300 ease-out",
                    showGoldenScoring
                      ? "max-h-[440px] opacity-100"
                      : "max-h-0 opacity-0 pointer-events-none",
                  ].join(" ")}
                  aria-hidden={!showGoldenScoring}
                >
                  <div className="grid gap-3 pt-1 md:grid-cols-3">
                    <div
                      className={[
                        "rounded-[22px] border border-yellow-300/22 bg-[linear-gradient(180deg,rgba(250,204,21,0.06),rgba(250,204,21,0.015))] px-4 py-3 transform transition-all duration-300",
                        showGoldenScoring
                          ? "translate-y-0 opacity-100"
                          : "-translate-y-2 opacity-0",
                      ].join(" ")}
                    >
                      <div className={MINI_LABEL}>Correct result</div>
                      <div className="mt-2 font-display text-xl font-semibold text-foreground">
                        +2
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        Winner or draw called correctly.
                      </div>
                    </div>
                    <div
                      className={[
                        "rounded-[22px] border border-yellow-300/22 bg-[linear-gradient(180deg,rgba(250,204,21,0.06),rgba(168,85,247,0.02))] px-4 py-3 transform transition-all duration-300 delay-75",
                        showGoldenScoring
                          ? "translate-y-0 opacity-100"
                          : "-translate-y-2 opacity-0",
                      ].join(" ")}
                    >
                      <div className={MINI_LABEL}>Exact score</div>
                      <div className="mt-2 font-display text-xl font-semibold text-foreground">
                        +4
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        Exact scoreline landed.
                      </div>
                    </div>
                    <div
                      className={[
                        "rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.008))] px-4 py-3 transform transition-all duration-300 delay-150",
                        showGoldenScoring
                          ? "translate-y-0 opacity-100"
                          : "-translate-y-2 opacity-0",
                      ].join(" ")}
                    >
                      <div className={MINI_LABEL}>Miss</div>
                      <div className="mt-2 font-display text-xl font-semibold text-foreground">
                        0
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        No points on the selected golden fixture.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        ) : null}

        {error && (
          <SectionCard className="rounded-[22px] border border-rose-400/35 bg-[linear-gradient(180deg,rgba(127,29,29,0.18),rgba(127,29,29,0.08))] p-4 sm:p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </SectionCard>
        )}

        {myGoldenLocked ? (
          <SectionCard className={PANEL_SHELL}>
            <div className={PANEL_INNER}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className={MINI_LABEL}>Golden lock</div>
                </div>
              </div>

              <div
                className="mt-4 rounded-[20px] border border-white/10 p-[clamp(0.75rem,1vw,1rem)] fixture-clash-bg bg-[linear-gradient(120deg,var(--locked-home,rgba(11,22,42,0.9))_0%,rgba(9,12,22,0.92)_42%,rgba(9,12,22,0.92)_58%,var(--locked-away,rgba(11,22,42,0.9))_100%)] shadow-[0_16px_30px_rgba(4,10,22,0.2)]"
                style={
                  {
                    "--locked-home": hexToRgba(lockedHomeColor, 0.26),
                    "--locked-away": hexToRgba(lockedAwayColor, 0.26),
                  } as React.CSSProperties
                }
              >
                <div className="relative rounded-[16px] border border-yellow-300/18 bg-[linear-gradient(180deg,rgba(6,10,18,0.95),rgba(8,12,20,0.93))] px-3 py-3">
                  <span className="pointer-events-none absolute inset-0 rounded-[16px] bg-[linear-gradient(128deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_34%,rgba(255,255,255,0)_62%,rgba(250,204,21,0.05)_100%)]" />
                  <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,rgba(253,224,71,0.95),rgba(250,204,21,0.42))]" />
                  <div className="relative z-[1]">
                    <div className="mb-2 flex justify-center sm:justify-end">
                      <span className="inline-flex rounded-full border border-yellow-300/35 bg-[rgba(40,30,20,0.72)] px-2 py-0.5 font-display text-[0.55rem] uppercase tracking-[0.15em] text-amber-100/90">
                        Golden locked
                      </span>
                    </div>

                    {lockedFixture ? (
                      <>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={lockedFixture.home.name}
                              tla={lockedFixture.home.tla}
                              shortName={lockedFixture.home.shortName}
                              badge={lockedFixture.home.badge}
                            />
                            <TeamLabel
                              name={lockedFixture.home.name}
                              tla={lockedFixture.home.tla}
                              shortName={lockedFixture.home.shortName}
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
                              name={lockedFixture.away.name}
                              tla={lockedFixture.away.tla}
                              shortName={lockedFixture.away.shortName}
                              badge={lockedFixture.away.badge}
                            />
                            <TeamLabel
                              name={lockedFixture.away.name}
                              tla={lockedFixture.away.tla}
                              shortName={lockedFixture.away.shortName}
                              showFullName={false}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                              fullNameWindowPx={68}
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center font-display text-sm font-semibold text-foreground">
                        Fixture #{myGolden.fixtureId}
                      </div>
                    )}

                    <div className="mt-2 flex items-center justify-center rounded-xl border border-yellow-300/35 bg-[linear-gradient(135deg,rgba(250,204,21,0.1),rgba(196,138,40,0.06))] px-3 py-2">
                      <span className="font-display text-xl font-semibold text-foreground tabular-nums">
                        {String(myGolden.score).replace("-", " - ")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-3 py-2.5">
                <div className="inline-flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Waiting for others to lock in…</span>
                </div>
              </div>
            </div>
          </SectionCard>
        ) : (
          <>
            <SectionCard className={PANEL_SHELL}>
              <div className={PANEL_INNER}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className={MINI_LABEL}>Golden draft board</div>
                    <div className="font-display text-lg font-semibold text-foreground">
                      Choose the fixture to upgrade
                    </div>
                    <div className="mt-2 text-sm text-muted">
                      Select one fixture you already predicted, then lock it as
                      your golden.
                    </div>
                  </div>
                  {!allowIdenticalPicks ? (
                    <button
                      type="button"
                      onClick={toggleCompactOtherPicks}
                      className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/18 hover:text-foreground"
                    >
                      {compactOtherPicks ? "Expand Others" : "Collapse Others"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 grid items-start gap-4 sm:gap-5 pt-2 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {orderedFixtureIds.map((fid, idx) => {
                    const f = fixtureMap.get(fid);
                    const myScore = activeMyPicksByFixture[fid];
                    const others = (picksByFixture.get(fid) ?? [])
                      .filter((p) => p.uid !== user.uid)
                      .map((p) => p.score);

                    const isSelected = selectedFixtureId === fid;
                    const homeColor = colorForTeam(
                      f?.home.tla,
                      f?.home.shortName,
                      f?.home.name,
                    );
                    const awayColor = colorForTeam(
                      f?.away.tla,
                      f?.away.shortName,
                      f?.away.name,
                    );
                    const clashBgStyle: React.CSSProperties = {
                      backgroundImage: `linear-gradient(120deg, ${hexToRgba(homeColor, isSelected ? 0.32 : 0.22)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(awayColor, isSelected ? 0.32 : 0.22)} 100%)`,
                    };

                    return (
                      <div
                        key={fid}
                        className="fixture-card-enter [contain:none] space-y-2 w-full"
                        style={{
                          animationDelay: `${Math.min(idx, 5) * 50}ms`,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedFixtureId(fid)}
                          disabled={!myScore}
                          className={[
                            "fixture-clash-bg no-3d relative w-full text-left rounded-[20px] border p-[clamp(0.8rem,1.1vw,1.15rem)] transition-all duration-200 page-action-btn",
                            isSelected
                              ? "z-20 overflow-visible border-yellow-300/55 ring-1 ring-inset ring-yellow-300/16 bg-[linear-gradient(160deg,rgba(255,255,255,0.07)_0%,rgba(250,204,21,0.07)_28%,rgba(10,14,24,0)_60%)] shadow-[0_16px_34px_rgba(34,26,6,0.3),0_0_0_1px_rgba(250,204,21,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]"
                              : "overflow-hidden border-white/12 opacity-[0.86] hover:opacity-100 hover:border-white/18",
                            !myScore ? "opacity-60 cursor-not-allowed" : "",
                          ].join(" ")}
                          style={clashBgStyle}
                        >
                          <div
                            className={[
                              "relative z-[1] space-y-2.5 rounded-[16px] border bg-[linear-gradient(180deg,rgba(6,10,18,0.94),rgba(8,12,20,0.92))] px-2.5 py-2.5",
                              isSelected
                                ? "border-yellow-300/18 ring-1 ring-inset ring-yellow-300/12"
                                : "border-white/6",
                            ].join(" ")}
                          >
                            {isSelected ? (
                              <>
                                <span className="pointer-events-none absolute inset-0 rounded-[16px] bg-[linear-gradient(128deg,rgba(255,255,255,0.1)_0%,rgba(255,255,255,0.02)_34%,rgba(255,255,255,0)_62%,rgba(250,204,21,0.05)_100%)]" />
                                <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,rgba(253,224,71,0.95),rgba(250,204,21,0.42))]" />
                                <span className="absolute left-4 right-4 bottom-0 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(253,224,71,0.24)_24%,rgba(253,224,71,0.24)_76%,rgba(255,255,255,0)_100%)]" />
                              </>
                            ) : null}
                            {isSelected ? (
                              <div className="mb-1 flex justify-center sm:justify-end">
                                <span className="inline-flex rounded-full border border-yellow-300/35 bg-[rgba(40,30,20,0.72)] px-2 py-0.5 font-display text-[0.55rem] uppercase tracking-[0.15em] text-amber-100/90">
                                  Selected
                                </span>
                              </div>
                            ) : null}
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
                                <div className="font-semibold text-foreground">
                                  Fixture {fid}
                                </div>
                              )}
                            </div>
                            <div className="my-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.08),rgba(255,255,255,0))]" />
                            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                              <span
                                className={[
                                  "shrink-0 whitespace-nowrap font-display text-xl leading-none font-semibold tabular-nums",
                                  "text-foreground",
                                ].join(" ")}
                              >
                                {myScore ? myScore.replace("-", " - ") : "—"}
                              </span>
                            </div>
                          </div>

                          {!allowIdenticalPicks && (
                            <div className="mt-0">
                              <div
                                className={[
                                  "text-[10px] uppercase tracking-[0.16em] text-muted/70 text-center transition-all duration-200 ease-out",
                                  compactOtherPicks
                                    ? "opacity-0 -translate-y-1 max-h-0 overflow-hidden"
                                    : "mt-2 opacity-100 translate-y-0 max-h-5",
                                ].join(" ")}
                              >
                                Other picks
                              </div>
                              <div
                                className={[
                                  "grid overflow-hidden transition-[grid-template-rows,opacity,transform,margin] duration-300 ease-out",
                                  compactOtherPicks
                                    ? "grid-rows-[0fr] opacity-0 -translate-y-1 mt-0 pointer-events-none"
                                    : "grid-rows-[1fr] opacity-100 translate-y-0 mt-1.5",
                                ].join(" ")}
                              >
                                <div className="min-h-0">
                                  {others.length === 0 ? (
                                    <div className="text-xs text-muted text-center">
                                      None
                                    </div>
                                  ) : (
                                    <div
                                      className={[
                                        "flex flex-wrap items-center justify-center gap-1.5 transition-all duration-300",
                                        compactOtherPicks
                                          ? "opacity-0 translate-y-1"
                                          : "opacity-100 translate-y-0",
                                      ].join(" ")}
                                    >
                                      {others.slice(0, 10).map((score, idx) => (
                                        <span
                                          key={`${fid}-other-${idx}-${score}`}
                                          className="font-display rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-foreground tabular-nums whitespace-nowrap"
                                        >
                                          {String(score).replace("-", " - ")}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
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
            </SectionCard>
            <SectionCard className={PANEL_SHELL}>
              <div className={PANEL_INNER}>
                <div className="grid gap-4">
                  <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className={MINI_LABEL}>Selection control</div>
                        <div className="font-display text-lg font-semibold text-foreground">
                          {selectedFixture
                            ? "Fixture selected"
                            : "Select a fixture"}
                        </div>
                        <div className="text-sm text-muted">
                          {selectedFixture && selectedFixtureScore
                            ? "Lock this fixture to promote the saved score below."
                            : "Pick one of your saved fixtures to continue."}
                        </div>
                      </div>
                    </div>

                    {selectedFixture ? (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-3 py-3">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={selectedFixture.home.name}
                              tla={selectedFixture.home.tla}
                              shortName={selectedFixture.home.shortName}
                              badge={selectedFixture.home.badge}
                            />
                            <div className="mt-1 font-display text-xs font-semibold uppercase tracking-wide text-foreground">
                              {selectedFixture.home.tla ||
                                selectedFixture.home.shortName ||
                                selectedFixture.home.name}
                            </div>
                          </div>
                          <span className="font-display text-[10px] sm:text-[11px] font-semibold text-muted uppercase inline-flex items-center justify-center">
                            vs
                          </span>
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={selectedFixture.away.name}
                              tla={selectedFixture.away.tla}
                              shortName={selectedFixture.away.shortName}
                              badge={selectedFixture.away.badge}
                            />
                            <div className="mt-1 font-display text-xs font-semibold uppercase tracking-wide text-foreground">
                              {selectedFixture.away.tla ||
                                selectedFixture.away.shortName ||
                                selectedFixture.away.name}
                            </div>
                          </div>
                        </div>
                        {selectedFixtureScore ? (
                          <div className="mt-3 flex items-center justify-center rounded-xl border border-yellow-300/35 bg-[linear-gradient(135deg,rgba(250,204,21,0.1),rgba(196,138,40,0.06))] px-3 py-2">
                            <span className="font-display text-xl font-semibold text-foreground tabular-nums">
                              {selectedFixtureScore.replace("-", " - ")}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      onClick={lockGolden}
                      disabled={
                        submitting ||
                        isLocked ||
                        selectedFixtureId == null ||
                        !activeMyPicksByFixture[selectedFixtureId]
                      }
                      className={`mt-4 ${ACTION_BTN}`}
                    >
                      {submitting ? "Locking…" : "Lock-In"}
                    </button>
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </SectionStack>
    </PageShell>
  );
}
