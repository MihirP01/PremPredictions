"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import AnimatedModal from "../../../../../components/AnimatedModal";
import PageShell from "../../../../../components/PageShell";
import SectionCard from "../../../../../components/SectionCard";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import TopActionRow from "../../../../../components/TopActionRow";
import {
  getRoomBootstrapCached,
  patchRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import {
  subscribeRoomGameDoc,
  subscribeRoomMeta,
  subscribeRoomPicks,
  subscribeRoomPlayers,
} from "@/lib/liveGameBus";
import {
  CaptainBanner,
  CaptainChooseFixturePanel,
  CaptainTurnIndicator,
} from "./modes/CaptainMode";
import {
  RoundRobinActionPanel,
  RoundRobinTurnIndicator,
} from "./modes/RoundRobinMode";
import { TakenScoresStrip } from "./modes/ScoreDesk";
import { SprintActionPanel, SprintTurnIndicator } from "./modes/SprintMode";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "POWERUPS" | "REVEAL";
  order: string[];
  fixtureIds: number[];
  currentTurn: number;
  totalTurns: number;
  players: string[];
  draftMode?: "turn" | "parallel";
  gameModeStyle?: "round_robin" | "sprint" | "captain";
  currentFixtureId?: number | null;
  draftReadyByUid?: Record<string, boolean>;
  sameResultLock?: boolean;
  lockAt?: unknown;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: {
    name: string;
    shortName?: string | null;
    tla?: string | null;
    badge?: string | null;
  };
  away: {
    name: string;
    shortName?: string | null;
    tla?: string | null;
    badge?: string | null;
  };
  result?: string | null;
};

type PickDoc = { uid?: string; fixtureId?: number; score?: string };
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

function onlyDigitsOrEmpty(v: string) {
  return v === "" || /^\d+$/.test(v);
}

export default function MiniGamePlayPage() {
  const params = useParams<{ roomCode: string }>();
  const searchParams = useSearchParams();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();
  const devPreview = searchParams.get("devPreview") === "1";

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [takenScores, setTakenScores] = useState<string[]>([]);
  const [captainFixtureChoice, setCaptainFixtureChoice] = useState<
    number | null
  >(null);
  const [displayNamesByUid, setDisplayNamesByUid] = useState<
    Record<string, string>
  >({});
  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stoppingPredictions, setStoppingPredictions] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [bootstrapState, setBootstrapState] = useState<string>("");
  const [bootstrapResolved, setBootstrapResolved] = useState(false);
  const bootstrapRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, user, router]);

  // current GW
  useEffect(() => {
    let cancelled = false;
    const loadBootstrap = async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        const n = Number(data.currentGameweek ?? 1);
        if (!cancelled) {
          setGw(Number.isFinite(n) ? n : 1);
          setSeasonKey(String(data.seasonKey || ""));
          setBootstrapState(
            String(data.gameState || "")
              .trim()
              .toUpperCase(),
          );
          setBootstrapResolved(true);
        }
      } catch {
        if (cancelled) return;
        bootstrapRetryRef.current = setTimeout(loadBootstrap, 1500);
      }
    };
    void loadBootstrap();
    return () => {
      cancelled = true;
      if (bootstrapRetryRef.current) {
        clearTimeout(bootstrapRetryRef.current);
        bootstrapRetryRef.current = null;
      }
    };
  }, [roomCode]);

  // load fixtures for GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const d = await getFixturesCached(gw, seasonKey);
      if (!cancelled) setFixtures(Array.isArray(d.fixtures) ? d.fixtures : []);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw, seasonKey]);

  // listen to game doc
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

  // listen to game doc
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomGameDoc(
      roomCode,
      seasonKey,
      gw,
      (data) => {
        const gameData = (data as GameDoc | null) ?? null;
        setGame(gameData);
        const st = String(gameData?.state || "")
          .trim()
          .toUpperCase();
        if (st) patchRoomBootstrapCached(roomCode, { gameState: st });
      },
      () => {},
    );
  }, [roomCode, gw, seasonKey]);

  // room leader
  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => setLeaderUid(roomMeta?.leaderUid ?? null),
      () => setLeaderUid(null),
    );
  }, [roomCode]);

  const isCaptainMode = game?.gameModeStyle === "captain";
  const isCaptainParallelMode =
    isCaptainMode &&
    (game?.sameResultLock === false || game?.draftMode === "parallel");
  const isParallelDraft =
    game?.draftMode === "parallel" ||
    (game?.gameModeStyle === "sprint" && game?.draftMode !== "turn");
  const isCaptainTurnMode = isCaptainMode && !isCaptainParallelMode;

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
    const rotatedIndex = (turnInFixture + fixtureIndex) % P;
    const uidTurn = order[rotatedIndex];
    let fixtureId: number | null = fixtureIds[fixtureIndex];
    if (isCaptainTurnMode) {
      const stored = Number(game.currentFixtureId);
      fixtureId =
        Number.isFinite(stored) && fixtureIds.includes(stored) ? stored : null;
    }

    return {
      uidTurn,
      fixtureId,
      fixtureIndex,
      turn,
      rotatedIndex,
      turnInFixture,
    };
  }, [game, isCaptainTurnMode]);

  const amITurn = !!user && !!current && current.uidTurn === user.uid;

  // listen to all picks for this GW
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
      setAllPicks(list);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gw, roomCode, seasonKey]);

  // listen to all picks for this GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPicks(
      roomCode,
      seasonKey,
      gw,
      (picks) => setAllPicks(picks as PickDoc[]),
      () => {},
    );
  }, [roomCode, gw, seasonKey]);

  // seed + listen player display names (nickname first)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cancelled || !cached.length) return;
        setDisplayNamesByUid((prev) => {
          const next = { ...prev };
          for (const player of cached) {
            const nick = String(player.nickName || "").trim();
            next[player.uid] =
              nick ||
              player.displayName ||
              next[player.uid] ||
              player.uid.slice(0, 6);
          }
          return next;
        });
      } catch {
        // ignore cache seed errors; live listener can still populate
      }
    })();

    const unsub = subscribeRoomPlayers(
      roomCode,
      (players) => {
        setDisplayNamesByUid((prev) => {
          const map: Record<string, string> = { ...prev };
          for (const player of players) {
            const nick = String(player.nickName || "").trim();
            map[player.uid] =
              nick ||
              player.displayName ||
              map[player.uid] ||
              player.uid.slice(0, 6);
          }
          return map;
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [roomCode]);

  const myPickedFixtureIds = useMemo(() => {
    if (!user) return new Set<number>();
    const mine = allPicks.filter((p) => p.uid === user.uid);
    return new Set(
      mine.map((p) => Number(p.fixtureId)).filter((id) => Number.isFinite(id)),
    );
  }, [allPicks, user]);
  const myPickByFixture = useMemo(() => {
    const m = new Map<number, string>();
    if (!user) return m;
    for (const p of allPicks) {
      if (p.uid !== user.uid) continue;
      const fid = Number(p.fixtureId);
      const sc = String(p.score || "").trim();
      if (Number.isFinite(fid) && sc) m.set(fid, sc);
    }
    return m;
  }, [allPicks, user]);
  const parallelActiveFixtureId = useMemo(() => {
    const fixtureIds = game?.fixtureIds ?? [];
    if (!fixtureIds.length) return null;
    const idx = Number(game?.currentTurn ?? 0);
    if (!Number.isFinite(idx) || idx < 0 || idx >= fixtureIds.length)
      return null;
    return fixtureIds[idx];
  }, [game?.fixtureIds, game?.currentTurn]);

  const activeFixtureId = useMemo(() => {
    if (!game) return null;
    if (isCaptainParallelMode) {
      const stored = Number(game.currentFixtureId);
      const validIds = game.fixtureIds ?? [];
      return Number.isFinite(stored) && validIds.includes(stored)
        ? stored
        : null;
    }
    return isParallelDraft
      ? parallelActiveFixtureId
      : (current?.fixtureId ?? null);
  }, [
    game,
    isCaptainParallelMode,
    isParallelDraft,
    parallelActiveFixtureId,
    current?.fixtureId,
  ]);
  const remainingCaptainFixtureIds = useMemo(() => {
    if (!isCaptainMode) return [] as number[];
    const fixtureIds = game?.fixtureIds ?? [];
    const usedFixtureIds = new Set(
      allPicks
        .map((p) => Number(p.fixtureId))
        .filter((id) => Number.isFinite(id)),
    );
    return fixtureIds.filter((fid) => !usedFixtureIds.has(fid));
  }, [isCaptainMode, game?.fixtureIds, allPicks]);
  const captainTurnNeedsFixtureChoice =
    (isCaptainTurnMode &&
      !!amITurn &&
      current?.turnInFixture === 0 &&
      !activeFixtureId) ||
    (isCaptainParallelMode &&
      !!user &&
      !!game?.order?.length &&
      game.order[Number(game.currentTurn ?? 0) % game.order.length] ===
        user.uid &&
      !activeFixtureId);
  const effectiveFixtureId = captainTurnNeedsFixtureChoice
    ? captainFixtureChoice
    : activeFixtureId;

  const latestLockedPick = useMemo(() => {
    // Prefer the pick for the currently active fixture.
    if (effectiveFixtureId != null) {
      const score = myPickByFixture.get(effectiveFixtureId);
      if (score) return { fixtureId: effectiveFixtureId, score };
    }

    // Fallback: most recent pick across fixture order.
    const fixtureIds = game?.fixtureIds ?? [];
    for (let i = fixtureIds.length - 1; i >= 0; i -= 1) {
      const fid = fixtureIds[i];
      const score = myPickByFixture.get(fid);
      if (score) return { fixtureId: fid, score };
    }
    return null;
  }, [effectiveFixtureId, game?.fixtureIds, myPickByFixture]);

  useEffect(() => {
    if (!captainTurnNeedsFixtureChoice) {
      setCaptainFixtureChoice(null);
      return;
    }
    setCaptainFixtureChoice((prev) => {
      if (prev != null && remainingCaptainFixtureIds.includes(prev))
        return prev;
      return remainingCaptainFixtureIds[0] ?? null;
    });
  }, [captainTurnNeedsFixtureChoice, remainingCaptainFixtureIds]);

  useEffect(() => {
    const scores = allPicks
      .filter((p) => Number(p.fixtureId) === effectiveFixtureId)
      .map((p) => String(p.score || "").trim())
      .filter(Boolean);
    setTakenScores(scores);
  }, [allPicks, effectiveFixtureId]);

  useEffect(() => {
    // reset inputs when fixture changes
    setHomeScore("");
    setAwayScore("");
    setErr(null);
  }, [effectiveFixtureId]);

  const standardSectionCardClass =
    "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5";

  if (gw == null || fixtures == null) {
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-4 pt-2 bg-app sm:px-3 sm:pb-4 sm:pt-2"
        contentClassName="relative z-[1] space-y-4"
      >
        <SectionCard className={standardSectionCardClass}>
          <div className="text-sm text-muted inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading…</span>
          </div>
        </SectionCard>
      </PageShell>
    );
  }
  if (!game) {
    if (bootstrapState === "LOBBY") {
      router.replace(`/room/${roomCode}/minigame`);
      return null;
    }
    if (bootstrapState === "GOLDEN") {
      router.replace(`/room/${roomCode}/minigame/golden`);
      return null;
    }
    if (bootstrapState === "REVEAL") {
      router.replace(`/room/${roomCode}/minigame/reveal`);
      return null;
    }
    if (bootstrapState === "POWERUPS") {
      router.replace(`/room/${roomCode}/minigame/powerups`);
      return null;
    }
    if (!bootstrapResolved || bootstrapState === "DRAFT") {
      return (
        <PageShell
          width="wide"
          shellChrome={false}
          outerClassName="min-h-0 px-2 pb-4 pt-2 bg-app sm:px-3 sm:pb-4 sm:pt-2"
          contentClassName="relative z-[1] space-y-4"
        >
          <SectionCard className={standardSectionCardClass}>
            <div className="text-sm text-muted inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading…</span>
            </div>
          </SectionCard>
        </PageShell>
      );
    }
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-4 pt-2 bg-app sm:px-3 sm:pb-4 sm:pt-2"
        contentClassName="relative z-[1] space-y-4"
      >
        <SectionCard className={standardSectionCardClass}>
          <div className="text-sm text-muted">Game not started yet.</div>
        </SectionCard>
      </PageShell>
    );
  }

  // phase routing
  if (game.state === "LOBBY") {
    router.replace(`/room/${roomCode}/minigame`);
    return null;
  }
  if (game.state === "GOLDEN") {
    router.replace(`/room/${roomCode}/minigame/golden`);
    return null;
  }
  if (game.state === "REVEAL") {
    router.replace(`/room/${roomCode}/minigame/reveal`);
    return null;
  }
  if (game.state === "POWERUPS") {
    router.replace(`/room/${roomCode}/minigame/powerups`);
    return null;
  }

  const fixture = fixtures.find((f) => f.fixtureId === effectiveFixtureId);
  const isLocked = false;

  const submitPick = async () => {
    if (!user) return;
    if (!isParallelDraft && !current) return;
    if (effectiveFixtureId == null) {
      setErr("Select a fixture first.");
      return;
    }
    const choosingCaptainFixture = captainTurnNeedsFixtureChoice;
    if (!choosingCaptainFixture && (homeScore === "" || awayScore === "")) {
      setErr("Enter both scores.");
      return;
    }
    const score = !choosingCaptainFixture
      ? `${homeScore}-${awayScore}`
      : undefined;
    if (isParallelDraft && myPickedFixtureIds.has(effectiveFixtureId)) {
      setErr("You already picked this fixture.");
      return;
    }

    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/game/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw,
          uid: user.uid,
          score,
          fixtureId: effectiveFixtureId,
          seasonKey,
        }),
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
  const fixtureTurnTotal = Math.max(1, game.fixtureIds?.length ?? 0);
  const fixtureTurnNumber = Math.max(
    1,
    Math.min(
      fixtureTurnTotal,
      fixtureTurnTotal - remainingCaptainFixtureIds.length + 1,
    ),
  );
  const playerTurnNumber = Math.max(1, Number(current?.turnInFixture ?? 0) + 1);
  const playerTurnTotal = Math.max(1, game.order?.length ?? 0);
  const waitingForCaptainFixture =
    isCaptainMode &&
    !captainTurnNeedsFixtureChoice &&
    effectiveFixtureId == null;
  const captainIsChoosingFixture =
    isCaptainMode &&
    (captainTurnNeedsFixtureChoice || waitingForCaptainFixture);
  const currentTurnName = current?.uidTurn
    ? displayNamesByUid[current.uidTurn] || current.uidTurn.slice(0, 6)
    : "current player";
  const captainUid =
    game?.order?.length && isCaptainParallelMode
      ? game.order[Number(game.currentTurn ?? 0) % game.order.length] || null
      : game?.order?.length && isCaptainTurnMode && current
        ? game.order[current.fixtureIndex % game.order.length] || null
        : null;
  const captainName = captainUid
    ? displayNamesByUid[captainUid] || captainUid.slice(0, 6)
    : null;
  const playersCount = game.players?.length ?? 0;
  const readyMap = game.draftReadyByUid ?? {};
  const lockedInCount = Object.values(readyMap).filter(Boolean).length;
  const myLockedIn = isParallelDraft
    ? !!(user && game.draftReadyByUid?.[user.uid])
    : !!(user && game.draftReadyByUid?.[user.uid]);
  const playersLeftToLock = Math.max(playersCount - lockedInCount, 0);
  const lockedProgressPct =
    playersCount > 0 ? Math.round((lockedInCount / playersCount) * 100) : 0;
  const isLeader = !!user && !!leaderUid && user.uid === leaderUid;
  const sprintTotalTurns = game.fixtureIds?.length ?? 0;
  const sprintTurnNumber = Math.max(
    1,
    Math.min(Math.max(sprintTotalTurns, 1), Number(game.currentTurn ?? 0) + 1),
  );
  const shouldShowTakenScores =
    !isParallelDraft &&
    game.sameResultLock !== false &&
    amITurn &&
    !captainTurnNeedsFixtureChoice &&
    !waitingForCaptainFixture &&
    effectiveFixtureId != null;
  const displayTakenScores = useMemo(
    () =>
      takenScores.length
        ? takenScores
        : devPreview
          ? ["1-0", "2-1", "0-0"]
          : [],
    [devPreview, takenScores],
  );

  const stopPredictions = async () => {
    if (!user || !isLeader || gw == null || !seasonKey) return;
    if (stoppingPredictions) return;
    setStopConfirmOpen(true);
  };

  const confirmStopPredictions = async () => {
    if (!user || !isLeader || gw == null || !seasonKey) return;
    if (stoppingPredictions) return;
    setStopConfirmOpen(false);

    setStoppingPredictions(true);
    setErr(null);
    try {
      const res = await fetch("/api/game/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw,
          leaderUid: user.uid,
          seasonKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to stop predictions");
      patchRoomBootstrapCached(roomCode, { gameState: "LOBBY" });
      router.replace(`/room/${roomCode}/minigame`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to stop predictions");
    } finally {
      setStoppingPredictions(false);
    }
  };

  const modeTitle =
    game?.gameModeStyle === "captain"
      ? "Captain"
      : isParallelDraft
        ? "Sprint"
        : "Round-Robin";

  return (
    <PageShell
      width="wide"
      shellChrome={false}
      outerClassName="min-h-0 px-2 pb-4 pt-2 bg-app sm:px-3 sm:pb-4 sm:pt-2"
      contentClassName="relative z-[1] space-y-4"
    >
      <div className="relative z-30 space-y-3">
        <TopActionRow
          title={
            <span
              className={
                modeTitle === "Round-Robin"
                  ? "inline-block text-[clamp(1.75rem,7.1vw,2.7rem)] tracking-[-0.012em]"
                  : undefined
              }
            >
              {modeTitle}
            </span>
          }
          subtitle={`${roomCode} • GW ${gw}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
          frameActions={false}
          actions={
            <div className="text-right">
              {isCaptainMode ? (
                <CaptainTurnIndicator
                  captainIsChoosingFixture={captainIsChoosingFixture}
                  fixtureTurnNumber={fixtureTurnNumber}
                  fixtureTurnTotal={fixtureTurnTotal}
                  playerTurnNumber={isCaptainParallelMode ? 1 : playerTurnNumber}
                  playerTurnTotal={isCaptainParallelMode ? 1 : playerTurnTotal}
                />
              ) : isParallelDraft ? (
                <SprintTurnIndicator
                  turnNumber={sprintTurnNumber}
                  totalTurns={Math.max(sprintTotalTurns, 1)}
                />
              ) : (
                <RoundRobinTurnIndicator
                  turnNumber={turnNumber}
                  totalTurns={totalTurns}
                />
              )}
            </div>
          }
        />
      </div>
      {isCaptainMode && captainName && (
        <CaptainBanner captainName={captainName} />
      )}
      {isLeader && game.state === "DRAFT" && (
        <SectionCard className={standardSectionCardClass}>
          <button
            onClick={stopPredictions}
            disabled={stoppingPredictions}
            className="w-full rounded-[18px] border border-amber-200/12 bg-[linear-gradient(90deg,rgba(78,56,33,0.88),rgba(52,42,34,0.82),rgba(78,56,33,0.88))] px-4 py-3 font-display text-base font-semibold tracking-[0.12em] text-foreground shadow-[0_16px_28px_rgba(40,24,10,0.22)] transition hover:border-amber-200/18 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stoppingPredictions ? "Stopping…" : "Stop Mini-game"}
          </button>
        </SectionCard>
      )}
      {stopConfirmOpen ? (
        <AnimatedModal
          open
          onClose={() => setStopConfirmOpen(false)}
          zIndexClassName="z-[90]"
          overlayClassName="bg-black/50"
          panelClassName="w-full max-w-sm rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,24,0.98),rgba(10,18,32,0.96))] p-4 space-y-4 shadow-[0_24px_56px_rgba(3,8,20,0.4)]"
        >
          <div className="text-lg font-semibold text-foreground">
            Stop Mini-game
          </div>
          <div className="text-sm text-muted">
            Stop this mini-game and send everyone back to lobby?
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setStopConfirmOpen(false)}
              disabled={stoppingPredictions}
              className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={confirmStopPredictions}
              disabled={stoppingPredictions}
              className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-danger hover:bg-surface-2 disabled:opacity-60"
            >
              Confirm Stop
            </button>
          </div>
        </AnimatedModal>
      ) : null}
      {/* fixture */}
      <SectionCard className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,16,28,0.98),rgba(7,12,22,0.97))] p-4 shadow-[0_20px_42px_rgba(4,8,16,0.32)] sm:p-5">
        {captainTurnNeedsFixtureChoice && (
          <div className="mb-3 space-y-2">
            <div className="text-xs text-muted text-center">
              Captain: choose fixture
            </div>
            <SpecialBreak />
            <div className="grid items-start gap-2 grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {remainingCaptainFixtureIds.map((fid) => {
                const f = fixtures.find((x) => x.fixtureId === fid);
                const isSelected = captainFixtureChoice === fid;
                const homeColor = f
                  ? colorForTeam(f.home.tla, f.home.shortName, f.home.name)
                  : "#475569";
                const awayColor = f
                  ? colorForTeam(f.away.tla, f.away.shortName, f.away.name)
                  : "#475569";
                const clashBgStyle: React.CSSProperties = {
                  backgroundImage: `linear-gradient(120deg, ${hexToRgba(homeColor, 0.2)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(awayColor, 0.2)} 100%)`,
                };
                return (
                  <button
                    key={fid}
                    type="button"
                    onClick={() => setCaptainFixtureChoice(fid)}
                    className={[
                      "relative w-full overflow-hidden rounded-tl-lg rounded-br-lg rounded-tr-none rounded-bl-none border p-3.5 text-left transition-all duration-200",
                      isSelected
                        ? "-translate-y-[1px] border-amber-200/30 text-foreground shadow-[0_16px_34px_rgba(44,27,12,0.3),inset_0_0_0_1px_rgba(255,225,178,0.12)]"
                        : "border-white/12 bg-surface text-foreground hover:border-white/22 hover:bg-surface-2",
                    ].join(" ")}
                    style={clashBgStyle}
                  >
                    {isSelected ? (
                      <>
                        <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-[linear-gradient(180deg,rgba(244,175,108,0.96)_0%,rgba(244,175,108,0.34)_100%)] shadow-[0_0_18px_rgba(244,175,108,0.28)]" />
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-[linear-gradient(180deg,rgba(244,175,108,0)_0%,rgba(244,175,108,0.18)_100%)]" />
                        <span className="pointer-events-none absolute right-2 top-2 rounded-full border border-amber-200/30 bg-[rgba(40,30,20,0.7)] px-2 py-0.5 font-display text-[0.58rem] uppercase tracking-[0.16em] text-amber-100/90">
                          Selected
                        </span>
                      </>
                    ) : null}
                    {f ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            badge={f.home.badge}
                            wrapperClassName="h-9 w-9 rounded-full"
                            imageClassName="h-7 w-7 object-contain"
                            fallbackClassName="text-[10px] font-bold text-foreground"
                          />
                          <TeamLabel
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            showFullName={false}
                            wrapperClassName="mt-1 flex w-[62px] min-[420px]:w-[72px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[10px] font-semibold text-foreground uppercase tracking-wide text-center"
                            fullNameWindowPx={58}
                          />
                        </div>
                        <span className="font-display text-[9px] uppercase">
                          vs
                        </span>
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            badge={f.away.badge}
                            wrapperClassName="h-9 w-9 rounded-full"
                            imageClassName="h-7 w-7 object-contain"
                            fallbackClassName="text-[10px] font-bold text-foreground"
                          />
                          <TeamLabel
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            showFullName={false}
                            wrapperClassName="mt-1 flex w-[62px] min-[420px]:w-[72px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[10px] font-semibold text-foreground uppercase tracking-wide text-center"
                            fullNameWindowPx={58}
                          />
                        </div>
                      </div>
                    ) : null}
                    {isSelected ? (
                      <span className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 bg-[linear-gradient(90deg,rgba(244,175,108,0)_0%,rgba(244,175,108,0.9)_18%,rgba(244,175,108,0.9)_82%,rgba(244,175,108,0)_100%)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {waitingForCaptainFixture ? (
          <div className="rounded-xl border-subtle bg-surface p-4 text-center">
            <div className="inline-flex items-center gap-2 text-muted">
              <Loader2 size={16} className="animate-spin" />
              <span>
                Waiting for{" "}
                <span className="font-display text-foreground">
                  {captainName || "captain"}
                </span>{" "}
                to choose fixture…
              </span>
            </div>
          </div>
        ) : null}
        {!captainTurnNeedsFixtureChoice && fixture && (
          <div
            className="fixture-clash-bg mb-2 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border border-white/15 bg-surface-2 px-3 py-3"
            style={{
              backgroundImage: `linear-gradient(120deg, ${hexToRgba(colorForTeam(fixture.home.tla, fixture.home.shortName, fixture.home.name), 0.2)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(colorForTeam(fixture.away.tla, fixture.away.shortName, fixture.away.name), 0.2)} 100%)`,
            }}
          >
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="flex flex-col items-center text-center min-w-0">
                <TeamBadge
                  name={fixture.home.name}
                  tla={fixture.home.tla}
                  shortName={fixture.home.shortName}
                  badge={fixture.home.badge}
                  wrapperClassName="h-10 w-10 rounded-full"
                  imageClassName="h-8 w-8 object-contain"
                  fallbackClassName="text-[10px] font-bold text-foreground"
                />
                <TeamLabel
                  name={fixture.home.name}
                  tla={fixture.home.tla}
                  shortName={fixture.home.shortName}
                  showFullName={false}
                  wrapperClassName="mt-1 flex w-[78px] sm:w-[86px] flex-col items-center gap-1 text-center"
                  abbrClassName="font-display w-full text-[10px] sm:text-[11px] font-semibold text-foreground uppercase tracking-wide text-center"
                  fullNameWindowPx={68}
                />
              </div>
              <div className="font-display text-xs text-muted uppercase">
                vs
              </div>
              <div className="flex flex-col items-center text-center min-w-0">
                <TeamBadge
                  name={fixture.away.name}
                  tla={fixture.away.tla}
                  shortName={fixture.away.shortName}
                  badge={fixture.away.badge}
                  wrapperClassName="h-10 w-10 rounded-full"
                  imageClassName="h-8 w-8 object-contain"
                  fallbackClassName="text-[10px] font-bold text-foreground"
                />
                <TeamLabel
                  name={fixture.away.name}
                  tla={fixture.away.tla}
                  shortName={fixture.away.shortName}
                  showFullName={false}
                  wrapperClassName="mt-1 flex w-[78px] sm:w-[86px] flex-col items-center gap-1 text-center"
                  abbrClassName="font-display w-full text-[10px] sm:text-[11px] font-semibold text-foreground uppercase tracking-wide text-center"
                  fullNameWindowPx={68}
                />
              </div>
            </div>
          </div>
        )}

        {shouldShowTakenScores ? (
          <div className="mt-3">
            <TakenScoresStrip scores={displayTakenScores} />
          </div>
        ) : null}
      </SectionCard>

      {err && (
        <SectionCard className="rounded-[20px] border border-red-300/20 bg-[linear-gradient(180deg,rgba(46,12,18,0.88),rgba(26,10,16,0.94))] p-4 shadow-[0_14px_28px_rgba(42,8,12,0.22)]">
          <div className="text-sm text-red-200">{err}</div>
        </SectionCard>
      )}

      {/* pick action */}
      {waitingForCaptainFixture ? null : captainTurnNeedsFixtureChoice ? (
        <CaptainChooseFixturePanel
          submitting={submitting}
          isLocked={isLocked}
          hasFixture={effectiveFixtureId != null}
          onSubmit={submitPick}
        />
      ) : isParallelDraft ? (
        <SprintActionPanel
          myLockedIn={myLockedIn}
          isCaptainMode={isCaptainParallelMode}
          latestLockedPick={latestLockedPick}
          lockedProgressPct={lockedProgressPct}
          playersLeftToLock={playersLeftToLock}
          homeScore={homeScore}
          awayScore={awayScore}
          onHomeChange={(v) => onlyDigitsOrEmpty(v) && setHomeScore(v)}
          onAwayChange={(v) => onlyDigitsOrEmpty(v) && setAwayScore(v)}
          submitting={submitting}
          isLocked={isLocked}
          hasFixture={effectiveFixtureId != null}
          onSubmit={submitPick}
        />
      ) : (
        <RoundRobinActionPanel
          amITurn={amITurn}
          currentTurnName={currentTurnName}
          waitingText={
            isCaptainParallelMode && !activeFixtureId ? (
              <>
                Waiting for{" "}
                <span className="font-display">{captainName || "captain"}</span>{" "}
                to choose fixture…
              </>
            ) : undefined
          }
          latestLockedPick={latestLockedPick}
          homeScore={homeScore}
          awayScore={awayScore}
          onHomeChange={(v) => onlyDigitsOrEmpty(v) && setHomeScore(v)}
          onAwayChange={(v) => onlyDigitsOrEmpty(v) && setAwayScore(v)}
          submitting={submitting}
          isLocked={isLocked}
          hasFixture={effectiveFixtureId != null}
          onSubmit={submitPick}
        />
      )}
    </PageShell>
  );
}
