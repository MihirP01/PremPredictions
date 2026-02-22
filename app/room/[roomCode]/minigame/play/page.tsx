"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import AnimatedModal from "../../../../../components/AnimatedModal";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { formatDateWithOrdinal, formatTime24 } from "@/lib/dateDisplay";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import {
  CaptainBanner,
  CaptainChooseFixturePanel,
  CaptainTurnIndicator,
} from "./modes/CaptainMode";
import { RoundRobinActionPanel, RoundRobinTurnIndicator } from "./modes/RoundRobinMode";
import { SprintActionPanel, SprintTurnIndicator } from "./modes/SprintMode";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
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
  home: { name: string; shortName?: string; tla?: string; badge?: string | null };
  away: { name: string; shortName?: string; tla?: string; badge?: string | null };
  result?: string | null;
};

type PickDoc = { uid?: string; fixtureId?: number; score?: string };
type RoomPlayerDoc = { displayName?: string; nickName?: string };
type RoomDoc = { leaderUid?: string };
const BTN_3D = "btn-3d-accent";

function onlyDigitsOrEmpty(v: string) {
  return v === "" || /^\d+$/.test(v);
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

  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [takenScores, setTakenScores] = useState<string[]>([]);
  const [captainFixtureChoice, setCaptainFixtureChoice] = useState<number | null>(null);
  const [displayNamesByUid, setDisplayNamesByUid] = useState<Record<string, string>>(
    {},
  );
  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stoppingPredictions, setStoppingPredictions] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);

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

  // room leader
  useEffect(() => {
    const roomRef = doc(db, "rooms", roomCode);
    return onSnapshot(
      roomRef,
      (snap) => {
        const data = snap.data() as RoomDoc | undefined;
        setLeaderUid(data?.leaderUid ?? null);
      },
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
        Number.isFinite(stored) && fixtureIds.includes(stored)
          ? stored
          : null;
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

    return onSnapshot(picksQ, (snap) => {
      const picks = snap.docs.map((d) => d.data() as PickDoc);
      setAllPicks(picks);
    });
  }, [roomCode, gw, seasonKey]);

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

  const myPickedFixtureIds = useMemo(() => {
    if (!user) return new Set<number>();
    const mine = allPicks.filter((p) => p.uid === user.uid);
    return new Set(
      mine
        .map((p) => Number(p.fixtureId))
        .filter((id) => Number.isFinite(id)),
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
  const latestLockedPick = useMemo(() => {
    const fixtureIds = game?.fixtureIds ?? [];
    for (let i = fixtureIds.length - 1; i >= 0; i -= 1) {
      const fid = fixtureIds[i];
      const sc = myPickByFixture.get(fid);
      if (sc) return { fixtureId: fid, score: sc };
    }
    return null;
  }, [game?.fixtureIds, myPickByFixture]);

  const parallelActiveFixtureId = useMemo(() => {
    const fixtureIds = game?.fixtureIds ?? [];
    if (!fixtureIds.length) return null;
    const idx = Number(game?.currentTurn ?? 0);
    if (!Number.isFinite(idx) || idx < 0 || idx >= fixtureIds.length) return null;
    return fixtureIds[idx];
  }, [game?.fixtureIds, game?.currentTurn]);

  const activeFixtureId = useMemo(() => {
    if (!game) return null;
    if (isCaptainParallelMode) {
      const stored = Number(game.currentFixtureId);
      return Number.isFinite(stored) ? stored : null;
    }
    return isParallelDraft ? parallelActiveFixtureId : current?.fixtureId ?? null;
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
      game.order[Number(game.currentTurn ?? 0) % game.order.length] === user.uid &&
      !activeFixtureId);
  const effectiveFixtureId =
    captainTurnNeedsFixtureChoice ? captainFixtureChoice : activeFixtureId;

  useEffect(() => {
    if (!captainTurnNeedsFixtureChoice) {
      setCaptainFixtureChoice(null);
      return;
    }
    setCaptainFixtureChoice((prev) => {
      if (prev != null && remainingCaptainFixtureIds.includes(prev)) return prev;
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

  if (gw == null || fixtures == null) {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

        <div className="text-sm text-muted">Game not started yet.</div>
      </div>
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
    const score = !choosingCaptainFixture ? `${homeScore}-${awayScore}` : undefined;
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
  const fixtureTurnNumber = Math.max(1, Number(current?.fixtureIndex ?? 0) + 1);
  const fixtureTurnTotal = Math.max(1, game.fixtureIds?.length ?? 0);
  const playerTurnNumber = Math.max(1, Number(current?.turnInFixture ?? 0) + 1);
  const playerTurnTotal = Math.max(1, game.order?.length ?? 0);
  const captainIsChoosingFixture = isCaptainMode && !activeFixtureId;
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
  const captainParallelTurnNumber = Math.max(
    1,
    Math.min(Math.max(playerTurnTotal, 1), lockedInCount + (myLockedIn ? 0 : 1)),
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
    } catch (e: unknown) {
      setErr(
        e instanceof Error ? e.message : "Failed to stop predictions",
      );
    } finally {
      setStoppingPredictions(false);
    }
  };

  return (
    <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">
              {game.gameModeStyle === "captain"
                ? "Captain"
                : isParallelDraft
                  ? "Sprint"
                  : "Round-Robin"}
            </h1>
            <div className="font-display text-sm text-muted">
              Room {roomCode} • GW {gw}
            </div>
          </div>
          <div className="text-right -mt-1">
            {isCaptainMode ? (
              <CaptainTurnIndicator
                captainIsChoosingFixture={captainIsChoosingFixture}
                fixtureTurnNumber={fixtureTurnNumber}
                fixtureTurnTotal={fixtureTurnTotal}
                playerTurnNumber={isCaptainParallelMode ? captainParallelTurnNumber : playerTurnNumber}
                playerTurnTotal={playerTurnTotal}
              />
            ) : isParallelDraft ? (
              <SprintTurnIndicator
                turnNumber={sprintTurnNumber}
                totalTurns={Math.max(sprintTotalTurns, 1)}
              />
            ) : (
              <RoundRobinTurnIndicator turnNumber={turnNumber} totalTurns={totalTurns} />
            )}
          </div>
        </div>
        {isCaptainMode && captainName && (
          <CaptainBanner captainName={captainName} />
        )}
        {isLeader && game.state === "DRAFT" && (
          <button
              onClick={stopPredictions}
              disabled={stoppingPredictions}
              className={`w-full rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60 ${BTN_3D}`}
            >
            {stoppingPredictions ? "Stopping…" : "Stop Mini-game"}
          </button>
        )}
        <AnimatedModal
          open={stopConfirmOpen}
          onClose={() => setStopConfirmOpen(false)}
          zIndexClassName="z-50"
          overlayClassName="bg-black/50"
          panelClassName="w-full max-w-sm rounded-2xl border border-teal-500 bg-surface p-4 space-y-4"
        >
          <div className="text-lg font-semibold text-foreground">Stop Mini-game</div>
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
        {/* fixture */}
        <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
          {captainTurnNeedsFixtureChoice && (
            <div className="mb-3 space-y-2">
              <div className="text-xs text-muted text-center">Captain: choose fixture</div>
              <SpecialBreak />
              <div className="grid items-start gap-2 grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {remainingCaptainFixtureIds.map((fid) => {
                  const f = fixtures.find((x) => x.fixtureId === fid);
                  const isSelected = captainFixtureChoice === fid;
                  const kickoffDate = f ? formatDateWithOrdinal(f.kickoff) : null;
                  const kickoffTime = f ? formatTime24(f.kickoff) : "";
                  return (
                    <button
                      key={fid}
                      type="button"
                      onClick={() => setCaptainFixtureChoice(fid)}
                      className={[
                        "w-full rounded-tl-lg rounded-br-lg rounded-tr-none rounded-bl-none border p-2 text-left transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground border-teal-400"
                          : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
                      ].join(" ")}
                    >
                      <div className="text-[10px] text-muted mb-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display">
                            {kickoffDate ? (
                              <>
                                {kickoffDate.dayNum}
                                <sup className="text-[8px] ml-[1px]">{kickoffDate.suffix}</sup>{" "}
                                {kickoffDate.monthYear}
                              </>
                            ) : (
                              `Fixture ${fid}`
                            )}
                          </span>
                          <span className="font-display tabular-nums">{kickoffTime}</span>
                        </div>
                      </div>
                      {f ? (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.home.name}
                              tla={f.home.tla}
                              shortName={f.home.shortName}
                              badge={f.home.badge}
                              wrapperClassName="h-10 w-10 rounded-full"
                              imageClassName="h-8 w-8 object-contain"
                              fallbackClassName="text-[10px] font-bold text-foreground"
                            />
                            <TeamLabel
                              name={f.home.name}
                              tla={f.home.tla}
                              shortName={f.home.shortName}
                              wrapperClassName="w-full"
                              abbrClassName="font-display mt-1 text-[10px] font-semibold truncate w-full"
                              fullNameClassName="hidden"
                            />
                          </div>
                          <span className="font-display text-[9px] uppercase">vs</span>
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.away.name}
                              tla={f.away.tla}
                              shortName={f.away.shortName}
                              badge={f.away.badge}
                              wrapperClassName="h-10 w-10 rounded-full"
                              imageClassName="h-8 w-8 object-contain"
                              fallbackClassName="text-[10px] font-bold text-foreground"
                            />
                            <TeamLabel
                              name={f.away.name}
                              tla={f.away.tla}
                              shortName={f.away.shortName}
                              wrapperClassName="w-full"
                              abbrClassName="font-display mt-1 text-[10px] font-semibold truncate w-full"
                              fullNameClassName="hidden"
                            />
                          </div>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {fixture && (
            <div className="space-y-2 mb-2">
              <div className="text-xs text-muted">
                <div className="flex items-center justify-between gap-2">
                  {(() => {
                    const d = formatDateWithOrdinal(fixture.kickoff);
                    return (
                      <span className="font-display font-semibold">
                        {d.dayNum}
                        <sup className="text-[9px] ml-[1px]">{d.suffix}</sup>{" "}
                        {d.monthYear}
                      </span>
                    );
                  })()}
                  <span className="font-display font-semibold tabular-nums">
                    {formatTime24(fixture.kickoff)}
                  </span>
                </div>
              </div>
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
                  wrapperClassName="mt-1 flex w-[78px] sm:w-full flex-col items-center gap-1 text-center"
                  abbrClassName="font-display w-full text-[10px] sm:text-xs font-semibold text-foreground uppercase tracking-wide text-center"
                  fullNameClassName="font-display w-full text-[9px] sm:text-[10px] font-medium text-muted leading-tight"
                  fullNameWindowPx={68}
                />
              </div>
              <div className="font-display text-xs text-muted uppercase">vs</div>
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
                  wrapperClassName="mt-1 flex w-[78px] sm:w-full flex-col items-center gap-1 text-center"
                  abbrClassName="font-display w-full text-[10px] sm:text-xs font-semibold text-foreground uppercase tracking-wide text-center"
                  fullNameClassName="font-display w-full text-[9px] sm:text-[10px] font-medium text-muted leading-tight"
                  fullNameWindowPx={68}
                />
              </div>
              </div>
            </div>
          )}

          {!isParallelDraft && game.sameResultLock !== false && (
            <div className="mt-3 text-sm text-center">
              <div className="font-semibold mb-2 text-foreground">
                Taken scores
              </div>

              {takenScores.length === 0 ? (
                <div className="text-muted">None yet</div>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  {takenScores.map((s, idx) => (
                    <span
                      key={`${s}-${idx}`}
                      className="text-xs bg-surface border border-teal-500 rounded-full px-2 py-1 text-foreground"
                    >
                      {s.replace("-", "–")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {err && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {err}
          </div>
        )}

        {/* pick action */}
        {captainTurnNeedsFixtureChoice ? (
          <CaptainChooseFixturePanel
            submitting={submitting}
            isLocked={isLocked}
            hasFixture={effectiveFixtureId != null}
            onSubmit={submitPick}
            btnClassName={BTN_3D}
          />
        ) : isParallelDraft ? (
          <SprintActionPanel
            myLockedIn={myLockedIn}
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
            btnClassName={BTN_3D}
          />
        ) : (
          <RoundRobinActionPanel
            amITurn={amITurn}
            currentTurnName={currentTurnName}
            waitingText={
              isCaptainParallelMode && !activeFixtureId ? (
                <>
                  Waiting for <span className="font-display">{captainName || "captain"}</span> to
                  choose fixture…
                </>
              ) : undefined
            }
            homeScore={homeScore}
            awayScore={awayScore}
            onHomeChange={(v) => onlyDigitsOrEmpty(v) && setHomeScore(v)}
            onAwayChange={(v) => onlyDigitsOrEmpty(v) && setAwayScore(v)}
            submitting={submitting}
            isLocked={isLocked}
            hasFixture={effectiveFixtureId != null}
            onSubmit={submitPick}
            btnClassName={BTN_3D}
          />
        )}
      </div>
    </div>
  );
}
