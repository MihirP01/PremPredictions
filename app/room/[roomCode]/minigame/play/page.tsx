"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import PendulumName from "../../../../../components/PendulumName";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import { coerceMillis, ONE_HOUR_MS } from "../lock-utils";

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

function teamAbbr(name: string, tla?: string, shortName?: string) {
  const t = String(tla || "").trim().toUpperCase();
  if (t.length === 3) return t;
  const s = String(shortName || "").trim();
  if (s && s.length <= 4) return s.toUpperCase();
  return (name || "").slice(0, 3).toUpperCase();
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

  const isParallelDraft =
    game?.draftMode === "parallel" ||
    (game?.gameModeStyle === "sprint" && game?.draftMode !== "turn");
  const isCaptainMode = !isParallelDraft && game?.gameModeStyle === "captain";

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
    if (isCaptainMode) {
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
  }, [game, isCaptainMode]);

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

  const activeFixtureId = isParallelDraft
    ? parallelActiveFixtureId
    : current?.fixtureId;
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
    isCaptainMode && !!amITurn && current?.turnInFixture === 0 && !activeFixtureId;
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
    if (!user) return;
    if (!isParallelDraft && !current) return;
    if (effectiveFixtureId == null) {
      setErr("Select a fixture first.");
      return;
    }
    if (isLocked) {
      setErr("Mini-game is locked (deadline passed).");
      return;
    }
    if (homeScore === "" || awayScore === "") {
      setErr("Enter both scores.");
      return;
    }
    const score = `${homeScore}-${awayScore}`;
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
    !isParallelDraft && current && game.order?.length
      ? game.order[current.fixtureIndex % game.order.length]
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

  const stopPredictions = async () => {
    if (!user || !isLeader || gw == null || !seasonKey) return;
    if (stoppingPredictions) return;
    const confirmed = window.confirm(
      "Stop this mini-game and send everyone back to lobby?",
    );
    if (!confirmed) return;

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
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-ui text-2xl font-semibold text-foreground">
              {isParallelDraft
                ? "Sprint"
                : game.gameModeStyle === "captain"
                  ? "Captain"
                  : "Round-Robin"}
            </h1>
            <div className="font-display text-sm text-muted">
              Room {roomCode} • GW {gw}
            </div>
          </div>
          <div className="text-right -mt-1">
            {isParallelDraft ? (
              <>
                <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
                  Turn {sprintTurnNumber}
                </div>
                <div className="font-display text-sm tracking-wide text-muted">
                  Out of {Math.max(sprintTotalTurns, 1)}
                </div>
              </>
            ) : isCaptainMode ? (
              <>
                <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
                  Turn {captainIsChoosingFixture ? fixtureTurnNumber : playerTurnNumber}
                </div>
                <div className="font-display text-sm tracking-wide text-muted">
                  Out of {captainIsChoosingFixture ? fixtureTurnTotal : playerTurnTotal}
                </div>
              </>
            ) : (
              <>
              <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
                Turn {turnNumber}
              </div>
              <div className="font-display text-sm tracking-wide text-muted">
                Out of {totalTurns}
              </div>
              </>
            )}
          </div>
        </div>
        {!isParallelDraft && game.gameModeStyle === "captain" && captainName && (
          <div className="border border-teal-500 rounded-xl p-3 bg-surface-2 text-center">
            <span className="text-xs text-muted uppercase tracking-wide">Captain</span>{" "}
            <span className="font-display font-semibold text-foreground">{captainName}</span>
          </div>
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
        {/* fixture */}
        <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
          {captainTurnNeedsFixtureChoice && (
            <div className="mb-3 space-y-2">
              <div className="text-xs text-muted text-center">Captain: choose fixture</div>
              <div className="grid grid-cols-2 gap-2">
                {remainingCaptainFixtureIds.map((fid) => {
                  const f = fixtures.find((x) => x.fixtureId === fid);
                  const isSelected = captainFixtureChoice === fid;
                  const kickoffDate = f ? fmtKickoffDateWithOrdinal(f.kickoff) : null;
                  const kickoffTime = f ? fmtKickoffTime(f.kickoff) : "";
                  return (
                    <button
                      key={fid}
                      type="button"
                      onClick={() => setCaptainFixtureChoice(fid)}
                      className={[
                        "rounded-lg border p-2 text-left transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground border-teal-400"
                          : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
                      ].join(" ")}
                    >
                      <div className="font-display text-[10px] mb-1">
                        {kickoffDate ? (
                          <>
                            {kickoffDate.dayNum}
                            <sup className="text-[8px] ml-[1px]">{kickoffDate.suffix}</sup>{" "}
                            {kickoffDate.monthYear}
                          </>
                        ) : (
                          `Fixture ${fid}`
                        )}
                      </div>
                      <div className="font-display text-[10px] mb-2">{kickoffTime}</div>
                      {f ? (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.home.name}
                              shortName={f.home.shortName}
                              badge={f.home.badge}
                            />
                            <span className="font-display mt-1 text-[10px] font-semibold truncate w-full">
                              {teamAbbr(f.home.name, f.home.tla, f.home.shortName)}
                            </span>
                          </div>
                          <span className="font-display text-[9px] uppercase">vs</span>
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.away.name}
                              shortName={f.away.shortName}
                              badge={f.away.badge}
                            />
                            <span className="font-display mt-1 text-[10px] font-semibold truncate w-full">
                              {teamAbbr(f.away.name, f.away.tla, f.away.shortName)}
                            </span>
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
              <div className="relative text-xs text-muted h-4">
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  {(() => {
                    const d = fmtKickoffDateWithOrdinal(fixture.kickoff);
                    return (
                      <span className="font-display font-semibold">
                        {d.dayNum}
                        <sup className="text-[9px] ml-[1px]">{d.suffix}</sup>{" "}
                        {d.monthYear}
                      </span>
                    );
                  })()}
                </div>
                <div className="font-display font-semibold absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
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
                  <span className="font-display block">
                    {teamAbbr(fixture.home.name, fixture.home.tla, fixture.home.shortName)}
                  </span>
                  <PendulumName
                    text={fixture.home.name}
                    windowPx={null}
                    className="font-display block text-[10px] font-medium text-muted w-[68px] sm:w-full mx-auto"
                  />
                </div>
              </div>
              <div className="font-display text-xs text-muted uppercase">vs</div>
              <div className="flex flex-col items-center text-center min-w-0">
                <TeamBadge
                  name={fixture.away.name}
                  shortName={fixture.away.shortName}
                  badge={fixture.away.badge}
                />
                <div className="mt-1 text-xs font-semibold text-foreground truncate w-full">
                  <span className="font-display block">
                    {teamAbbr(fixture.away.name, fixture.away.tla, fixture.away.shortName)}
                  </span>
                  <PendulumName
                    text={fixture.away.name}
                    windowPx={null}
                    className="font-display block text-[10px] font-medium text-muted w-[68px] sm:w-full mx-auto"
                  />
                </div>
              </div>
              </div>
            </div>
          )}

          {!isParallelDraft && (
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
        {isParallelDraft ? (
          myLockedIn ? (
            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground space-y-3 text-center">
              <div className="font-semibold text-foreground">Locked In</div>
              {latestLockedPick && (
                <div className="text-sm text-muted">
                  Your pick:{" "}
                  <span className="font-display text-foreground font-semibold tabular-nums">
                    {latestLockedPick.score.replace("-", "–")}
                  </span>
                </div>
              )}
              <div className="w-full h-2 rounded-full border border-teal-500 bg-surface overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${lockedProgressPct}%` }}
                />
              </div>
              <div className="text-sm text-muted">
                Waiting for others... {playersLeftToLock} left.
              </div>
            </div>
          ) : (
            <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
              <div className="font-semibold text-foreground">Submit your pick</div>
              <div className="flex items-center justify-center gap-3">
                <input
                  value={homeScore}
                  onChange={(e) =>
                    onlyDigitsOrEmpty(e.target.value) &&
                    setHomeScore(e.target.value)
                  }
                  className="font-display w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
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
                  className="font-display w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <button
                disabled={submitting || isLocked || effectiveFixtureId == null}
                onClick={submitPick}
                className={`w-full rounded-lg px-4 py-3 bg-accent text-accent-foreground disabled:opacity-60 ${BTN_3D}`}
              >
                {submitting ? "Submitting…" : "Confirm score"}
              </button>
            </div>
          )
        ) : amITurn ? (
          <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
            <div className="font-semibold text-foreground text-center">Your turn</div>

            <div className="flex items-center justify-center gap-3">
              <input
                value={homeScore}
                onChange={(e) =>
                  onlyDigitsOrEmpty(e.target.value) &&
                  setHomeScore(e.target.value)
                }
                className="font-display w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
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
                className="font-display w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0"
                inputMode="numeric"
              />
            </div>

            <button
              disabled={submitting || isLocked || effectiveFixtureId == null}
              onClick={submitPick}
              className={`w-full rounded-lg px-4 py-3 bg-accent text-accent-foreground disabled:opacity-60 ${BTN_3D}`}
            >
              {submitting ? "Submitting…" : "Confirm score"}
            </button>
          </div>
        ) : (
          <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground">
            Waiting for <span className="font-display">{currentTurnName}</span> to pick…
          </div>
        )}
      </div>
    </div>
  );
}
