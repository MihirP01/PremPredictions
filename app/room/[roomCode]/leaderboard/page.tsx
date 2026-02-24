"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import { SettingsDropdownPanel, SettingsTriggerButton } from "../../../../components/RoomSettingsMenu";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import SliderSwitch from "../../../../components/SliderSwitch";
import TopActionRow from "../../../../components/TopActionRow";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { subscribeRoomMeta, subscribeRoomPlayers } from "@/lib/liveGameBus";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import {
  collection,
  getDocs,
} from "firebase/firestore";

type Player = { uid: string; displayName: string };
type ScoreDoc = {
  uid?: string;
  points?: number;
  breakdown?: Record<string, { pred?: string | null }>;
};

type ScoreWeekSummaryDoc = {
  computedAt?: unknown;
};
function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

function parseGwId(id: string): number | null {
  const m = /^gw-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function toErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      // Call as an instance method so Firestore Timestamp keeps its `this`.
      const d = maybeTimestamp.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function fmtDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function rankLabel(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  return "🥉";
}

function youPillClass() {
  return "ml-1 inline-flex items-center rounded-full border border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted align-middle";
}

function podiumLabel(position: number) {
  if (position === 1) return "1st";
  if (position === 2) return "2nd";
  return "3rd";
}

function podiumTier(rank: number) {
  if (rank <= 1) return "gold" as const;
  if (rank === 2) return "silver" as const;
  return "bronze" as const;
}

function byName(a: Player, b: Player) {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

function assignCompetitionRanks<T>(
  ordered: T[],
  scoreOf: (item: T) => number,
  uidOf: (item: T) => string,
): Record<string, number> {
  const ranks: Record<string, number> = {};
  let prevScore: number | null = null;
  let rank = 0;
  ordered.forEach((item, index) => {
    const score = scoreOf(item);
    if (prevScore === null || score !== prevScore) rank = index + 1;
    ranks[uidOf(item)] = rank;
    prevScore = score;
  });
  return ranks;
}

export default function LeaderboardMatrixPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [players, setPlayers] = useState<Player[]>([]);
  const [currentGw, setCurrentGw] = useState<number>(1);
  const [seasonKey, setSeasonKey] = useState<string>("");
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [leaderToolBusy, setLeaderToolBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gwScoreComputedAt, setGwScoreComputedAt] = useState<Date | null>(null);
  const [leaderboardRefreshedAt, setLeaderboardRefreshedAt] =
    useState<Date | null>(null);
  const [refreshLockedUntil, setRefreshLockedUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [scoredGameweeks, setScoredGameweeks] = useState<number[]>([]);
  const [selectedTableGw, setSelectedTableGw] = useState<number>(1);
  const [topView, setTopView] = useState<"overall" | "current" | "previous">(
    "overall",
  );
  const [fullPositionsExpanded, setFullPositionsExpanded] = useState(false);
  const settingsWrapMobileRef = useRef<HTMLDivElement | null>(null);
  const settingsWrapDesktopRef = useRef<HTMLDivElement | null>(null);
  const seasonGwSyncPrimedRef = useRef(false);

  // matrix: userUid -> gw -> points (read only from score docs)
  const [pointsByUserByGw, setPointsByUserByGw] = useState<
    Record<string, Record<number, number>>
  >({});
  const [hasPredByUserByGw, setHasPredByUserByGw] = useState<
    Record<string, Record<number, boolean>>
  >({});

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, user, router]);

  // load default season + gameweek
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        const n = Number(data.currentGameweek ?? 1);
        const options = Array.isArray(data.seasonOptions) ? data.seasonOptions : [];
        const season = String(data.seasonKey || "");
        if (!cancelled) {
          setCurrentGw(Number.isFinite(n) ? n : 1);
          setSeasonKey(season);
          setLeaderUid(data.leaderUid ?? null);
          setSeasonOptions(
            options.length
              ? options
              : season
                ? [season]
                : [],
          );
        }
      } catch {
        if (!cancelled) {
          setCurrentGw(1);
          setSeasonKey("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  // whenever selected season changes, refresh season-specific current GW
  useEffect(() => {
    if (!seasonKey) return;
    if (!seasonGwSyncPrimedRef.current) {
      seasonGwSyncPrimedRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await getCurrentGameweekCached(seasonKey);
        const n = Number(data.currentGameweek ?? 1);
        if (!cancelled) setCurrentGw(Number.isFinite(n) ? n : 1);
      } catch {
        if (!cancelled) setCurrentGw(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seasonKey]);

  useEffect(() => {
    setSelectedTableGw(currentGw);
  }, [currentGw]);

  // live players list
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cancelled || !cached.length) return;
        const seeded: Player[] = cached
          .map((p) => ({
            uid: p.uid,
            displayName: String(p.nickName || "").trim() || p.displayName || "Player",
          }))
          .sort(byName);
        setPlayers(seeded);
      } catch {
        // ignore
      }
    })();
    const unsub = subscribeRoomPlayers(
      roomCode,
      (livePlayers) => {
        const list: Player[] = livePlayers
          .map((player) => {
            const nick = String(player.nickName || "").trim();
            return { uid: player.uid, displayName: nick || player.displayName || "Player" };
          })
          .sort(byName);
        setPlayers(list);
      },
      (e) =>
        setError(
          `Failed to load players: ${e?.message ?? "permission denied"}`,
        ),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [roomCode]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const el = target as Element;
      if (
        typeof (el as Element).closest === "function" &&
        el.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (settingsWrapMobileRef.current?.contains(target)) return;
      if (settingsWrapDesktopRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (refreshLockedUntil <= nowMs) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [refreshLockedUntil, nowMs]);

  // room leader (for leader-only tools)
  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => setLeaderUid(roomMeta?.leaderUid ?? null),
      () => setLeaderUid(null),
    );
  }, [roomCode]);

  const loadSavedScores = useCallback(async () => {
    if (players.length === 0 || !seasonKey) return;

    setBusy(true);
    setError(null);

    const matrix: Record<string, Record<number, number>> = {};
    const predMatrix: Record<string, Record<number, boolean>> = {};
    for (const p of players) {
      matrix[p.uid] = {};
      predMatrix[p.uid] = {};
      for (let gw = 1; gw <= currentGw; gw++) matrix[p.uid][gw] = 0;
      for (let gw = 1; gw <= currentGw; gw++) predMatrix[p.uid][gw] = false;
    }

    try {
      // Only read already-computed score docs, never recompute in leaderboard.
      const scoreWeeksSnap = await getDocs(
        collection(db, "rooms", roomCode, "seasons", seasonKey, "scores"),
      );
      let currentGwComputedAt: Date | null = null;
      for (const scoreWeekDoc of scoreWeeksSnap.docs) {
        if (scoreWeekDoc.id !== `gw-${currentGw}`) continue;
        const summary = scoreWeekDoc.data() as ScoreWeekSummaryDoc;
        const computedAt = asDate(summary.computedAt);
        if (computedAt && (!currentGwComputedAt || computedAt > currentGwComputedAt)) {
          currentGwComputedAt = computedAt;
        }
      }

      // "Scored" means we actually have per-user score docs for that GW.
      // Do not infer scored weeks from summary doc ids alone.
      const scoredWeeks = new Set<number>();

      let computedGws = scoreWeeksSnap.docs
        .map((d) => parseGwId(d.id))
        .filter((n): n is number => n !== null && n >= 1 && n <= currentGw);

      // If no score summaries, derive candidate weeks from seasonal games.
      if (computedGws.length === 0) {
        const gameWeeksSnap = await getDocs(
          collection(db, "rooms", roomCode, "seasons", seasonKey, "games"),
        );
        computedGws = gameWeeksSnap.docs
          .map((d) => parseGwId(d.id))
          .filter((n): n is number => n !== null && n >= 1 && n <= currentGw);
      }

      computedGws = Array.from(new Set(computedGws)).sort((a, b) => a - b);

      for (const gw of computedGws) {
        const usersSnap = await getDocs(
          collection(
            db,
            "rooms",
            roomCode,
            "seasons",
            seasonKey,
            "scores",
            `gw-${gw}`,
            "users",
          ),
        );

        let gwHasMeaningfulScore = false;
        for (const d of usersSnap.docs) {
          const data = d.data() as ScoreDoc;
          const uid = String(data.uid ?? d.id);
          const points = Number(data.points ?? 0);
          const hasPred = Object.values(data.breakdown ?? {}).some((b) =>
            Boolean(String(b?.pred ?? "").trim()),
          );

          if (!Number.isFinite(points)) continue;
          if (!matrix[uid]) continue; // only show current room players

          matrix[uid][gw] = points;
          predMatrix[uid][gw] = hasPred;
          if (hasPred || points > 0) gwHasMeaningfulScore = true;
        }
        if (gwHasMeaningfulScore) scoredWeeks.add(gw);
      }

      const scoredList = Array.from(scoredWeeks).sort((a, b) => a - b);
      setPointsByUserByGw(matrix);
      setHasPredByUserByGw(predMatrix);
      setGwScoreComputedAt(currentGwComputedAt);
      setLeaderboardRefreshedAt(new Date());
      setScoredGameweeks(scoredList);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load saved scores."));
    } finally {
      setBusy(false);
    }
  }, [players, currentGw, roomCode, seasonKey]);

  useEffect(() => {
    loadSavedScores().catch(() => {});
  }, [loadSavedScores]);

  const weeks = useMemo(
    () => Array.from({ length: currentGw }, (_, i) => currentGw - i),
    [currentGw],
  );

  const mobileGwOptions = useMemo(() => {
    const played = scoredGameweeks.filter((gw) => gw >= 1 && gw <= currentGw);
    return Array.from(new Set([currentGw, ...played])).sort((a, b) => b - a);
  }, [scoredGameweeks, currentGw]);

  useEffect(() => {
    if (!mobileGwOptions.length) return;
    if (!mobileGwOptions.includes(selectedTableGw)) {
      setSelectedTableGw(mobileGwOptions[0]);
    }
  }, [mobileGwOptions, selectedTableGw]);

  const totalByUser = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const p of players) {
      totals[p.uid] = weeks.reduce(
        (sum, gw) => sum + (pointsByUserByGw?.[p.uid]?.[gw] ?? 0),
        0,
      );
    }
    return totals;
  }, [players, pointsByUserByGw, weeks]);

  const sortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      const byPoints = (totalByUser[b.uid] ?? 0) - (totalByUser[a.uid] ?? 0);
      if (byPoints !== 0) return byPoints;
      return byName(a, b);
    });
    return list;
  }, [players, totalByUser]);

  const lastScoredGw = useMemo(() => {
    const beforeCurrent = scoredGameweeks.filter((gw) => gw < currentGw);
    if (beforeCurrent.length) return beforeCurrent[beforeCurrent.length - 1];
    if (scoredGameweeks.length) return scoredGameweeks[scoredGameweeks.length - 1];
    return currentGw;
  }, [scoredGameweeks, currentGw]);
  const medalsGw = lastScoredGw;

  const previousGwSortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort(
      (a, b) =>
        (pointsByUserByGw?.[b.uid]?.[lastScoredGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[lastScoredGw] ?? 0),
    );
    list.sort((a, b) => {
      const byPoints =
        (pointsByUserByGw?.[b.uid]?.[lastScoredGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[lastScoredGw] ?? 0);
      if (byPoints !== 0) return byPoints;
      return byName(a, b);
    });
    return list;
  }, [players, pointsByUserByGw, lastScoredGw]);

  const currentGwSortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      const byPoints =
        (pointsByUserByGw?.[b.uid]?.[currentGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[currentGw] ?? 0);
      if (byPoints !== 0) return byPoints;
      return byName(a, b);
    });
    return list;
  }, [players, pointsByUserByGw, currentGw]);

  const isLeader = !!user && leaderUid === user.uid;
  const refreshLockSeconds = Math.max(
    0,
    Math.ceil((refreshLockedUntil - nowMs) / 1000),
  );
  const rankedByTopView = useMemo(() => {
    if (topView === "current") return currentGwSortedPlayers;
    if (topView === "previous") return previousGwSortedPlayers;
    return sortedPlayers;
  }, [topView, sortedPlayers, currentGwSortedPlayers, previousGwSortedPlayers]);
  const topThreePlayers = useMemo(() => rankedByTopView.slice(0, 3), [rankedByTopView]);

  const scoreForTopView = useCallback(
    (uid: string) => {
      if (topView === "current") return pointsByUserByGw?.[uid]?.[currentGw] ?? 0;
      if (topView === "previous") return pointsByUserByGw?.[uid]?.[lastScoredGw] ?? 0;
      return totalByUser[uid] ?? 0;
    },
    [topView, pointsByUserByGw, currentGw, lastScoredGw, totalByUser],
  );
  const hasPredForTopView = useCallback(
    (uid: string) => {
      if (topView === "current") return !!hasPredByUserByGw?.[uid]?.[currentGw];
      if (topView === "previous") return !!hasPredByUserByGw?.[uid]?.[lastScoredGw];
      return weeks.some((gw) => !!hasPredByUserByGw?.[uid]?.[gw]);
    },
    [topView, hasPredByUserByGw, currentGw, lastScoredGw, weeks],
  );
  const scoreLabel = useCallback(
    (score: number, hasPred: boolean) => (score === 0 && hasPred ? "🦆" : String(score)),
    [],
  );
  const mobileGwSortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      const byGw =
        (pointsByUserByGw?.[b.uid]?.[selectedTableGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[selectedTableGw] ?? 0);
      if (byGw !== 0) return byGw;
      const byTotal = (totalByUser[b.uid] ?? 0) - (totalByUser[a.uid] ?? 0);
      if (byTotal !== 0) return byTotal;
      return byName(a, b);
    });
    return list;
  }, [players, pointsByUserByGw, selectedTableGw, totalByUser]);

  const topViewRankByUid = useMemo(() => {
    return assignCompetitionRanks(
      rankedByTopView,
      (p) => scoreForTopView(p.uid),
      (p) => p.uid,
    );
  }, [rankedByTopView, scoreForTopView]);

  const mobileGwRankByUid = useMemo(() => {
    return assignCompetitionRanks(
      mobileGwSortedPlayers,
      (p) => pointsByUserByGw?.[p.uid]?.[selectedTableGw] ?? 0,
      (p) => p.uid,
    );
  }, [mobileGwSortedPlayers, pointsByUserByGw, selectedTableGw]);

  const mobileSelectedGwIndex = useMemo(
    () => mobileGwOptions.findIndex((gw) => gw === selectedTableGw),
    [mobileGwOptions, selectedTableGw],
  );

  const gwRankByUid = useMemo(() => {
    const byGw: Record<number, Record<string, number>> = {};
    for (const gw of weeks) {
      const ranked = [...players].sort((a, b) => {
        const byPoints =
          (pointsByUserByGw?.[b.uid]?.[gw] ?? 0) -
          (pointsByUserByGw?.[a.uid]?.[gw] ?? 0);
        if (byPoints !== 0) return byPoints;
        const byTotal = (totalByUser[b.uid] ?? 0) - (totalByUser[a.uid] ?? 0);
        if (byTotal !== 0) return byTotal;
        return a.displayName.localeCompare(b.displayName);
      });
      byGw[gw] = assignCompetitionRanks(
        ranked,
        (p) => pointsByUserByGw?.[p.uid]?.[gw] ?? 0,
        (p) => p.uid,
      );
    }
    return byGw;
  }, [weeks, players, pointsByUserByGw, totalByUser]);
  const podiumSlots = useMemo(() => {
    return [0, 1, 2].map((index) => {
      const player = topThreePlayers[index] ?? null;
      const rank = player ? (topViewRankByUid[player.uid] ?? index + 1) : index + 1;
      return {
        position: rank,
        player,
        tier: podiumTier(rank),
      };
    });
  }, [topThreePlayers, topViewRankByUid]);

  async function recalcAndRefreshScores() {
    if (!user || !isLeader || !seasonKey) return;
    if (leaderToolBusy) return;

    setLeaderToolBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw: currentGw,
          leaderUid: user.uid,
          seasonKey,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to recalculate scores.");

      await loadSavedScores();
    } catch (e) {
      setError(toErrorMessage(e, "Failed to recalculate saved scores."));
    } finally {
      setLeaderToolBusy(false);
    }
  }

  async function refreshLeaderboard() {
    if (busy || refreshLockSeconds > 0) return;
    setRefreshLockedUntil(Date.now() + 10_000);
    setNowMs(Date.now());
    await loadSavedScores();
  }

  return (
    <PageShell>
        <div className="relative z-30 space-y-3">
          <TopActionRow
            title="Leaderboard"
            subtitle={`${roomCode} • ${seasonLabel(seasonKey || "----")}`}
            actions={
              <div className="ml-auto flex items-center gap-2">
                {isLeader && (
                  <div ref={settingsWrapMobileRef} className="relative sm:hidden">
                    <SettingsTriggerButton onClick={() => setSettingsOpen((v) => !v)} />
                    <SettingsDropdownPanel open={settingsOpen}>
                      <div className="font-display font-semibold text-foreground">Leader Tools</div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted">
                          Recalculate score docs, then reload leaderboard data.
                        </div>
                        <button
                          onClick={recalcAndRefreshScores}
                          disabled={leaderToolBusy}
                          className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                        >
                          {leaderToolBusy
                            ? `Recalculating around GW${currentGw}...`
                            : "Recalculate Scores"}
                        </button>
                      </div>
                    </SettingsDropdownPanel>
                  </div>
                )}
                <button
                  onClick={refreshLeaderboard}
                  disabled={busy || refreshLockSeconds > 0}
                  className="h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex sm:hidden items-center justify-center page-action-btn disabled:opacity-60"
                  aria-label="Refresh leaderboard"
                  title={
                    refreshLockSeconds > 0
                      ? `Refresh locked (${refreshLockSeconds}s)`
                      : "Refresh leaderboard"
                  }
                >
                  <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
                </button>
                <PageBackButton onClick={() => router.push(`/room/${roomCode}`)} />
              </div>
            }
          />

          <div className="flex items-center justify-between gap-2">
            {!!seasonOptions.length && (
              <div className="w-[132px] sm:w-[140px] relative">
                <label className="sr-only" htmlFor="season-select">
                  Select season
                </label>
                <select
                  id="season-select"
                  value={seasonKey}
                  onChange={(e) => setSeasonKey(e.target.value)}
                  className="w-full h-10 rounded-lg border border-teal-500 bg-surface text-foreground text-sm font-semibold px-8 text-center appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {seasonOptions.map((s) => (
                    <option key={s} value={s}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                  ▼
                </span>
              </div>
            )}
            <div className="ml-auto hidden sm:flex items-center gap-2 page-actions-enter">
              {isLeader && (
                <div ref={settingsWrapDesktopRef} className="relative">
                  <SettingsTriggerButton onClick={() => setSettingsOpen((v) => !v)} />
                  <SettingsDropdownPanel open={settingsOpen}>
                    <div className="font-display font-semibold text-foreground">Leader Tools</div>
                    <div className="space-y-2">
                      <div className="text-xs text-muted">
                        Recalculate score docs, then reload leaderboard data.
                      </div>
                      <button
                        onClick={recalcAndRefreshScores}
                        disabled={leaderToolBusy}
                        className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                      >
                        {leaderToolBusy
                          ? `Recalculating around GW${currentGw}...`
                          : "Recalculate Scores"}
                      </button>
                    </div>
                  </SettingsDropdownPanel>
                </div>
              )}
              <button
                onClick={refreshLeaderboard}
                disabled={busy || refreshLockSeconds > 0}
                className="h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex items-center justify-center page-action-btn disabled:opacity-60"
                aria-label="Refresh leaderboard"
                title={
                  refreshLockSeconds > 0
                    ? `Refresh locked (${refreshLockSeconds}s)`
                    : "Refresh leaderboard"
                }
              >
                <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        <div
          className="rounded-xl p-3 bg-surface-2 border border-teal-500 space-y-3"
          style={{ animationDelay: "120ms", animationDuration: "520ms" }}
        >
          <SliderSwitch
            options={[
              { value: "overall", label: "Overall" },
              { value: "current", label: `GW${currentGw}` },
              { value: "previous", label: `GW${medalsGw}` },
            ]}
            value={topView}
            onChange={setTopView}
            className="relative grid rounded-lg border border-teal-500 bg-surface p-1 overflow-hidden"
            buttonClassName="relative z-10 rounded-md px-2 py-2 text-xs font-semibold text-foreground transition-colors"
          />
          <div className="mt-2 grid grid-cols-3 items-end gap-2">
            {podiumSlots.map((slot, idx) => {
              const points = slot.player ? scoreForTopView(slot.player.uid) : 0;
              const hasPred = slot.player ? hasPredForTopView(slot.player.uid) : false;
              const barHeight =
                slot.tier === "gold"
                  ? "96px"
                  : slot.tier === "silver"
                    ? "76px"
                    : "58px";
              const barToneClass =
                slot.tier === "gold"
                  ? "metal-glow metal-glow-gold border-yellow-400/80 bg-[linear-gradient(90deg,rgba(250,204,21,0.36)_0%,rgba(250,204,21,0.18)_100%)]"
                  : slot.tier === "silver"
                    ? "metal-glow metal-glow-silver border-gray-300/80 bg-[linear-gradient(90deg,rgba(209,213,219,0.34)_0%,rgba(209,213,219,0.16)_100%)]"
                    : "metal-glow metal-glow-bronze border-amber-500/80 bg-[linear-gradient(90deg,rgba(245,158,11,0.34)_0%,rgba(245,158,11,0.16)_100%)]";
              return (
                <div key={`podium-slot-${idx}`} className="flex flex-col items-center gap-1">
                  <div className="w-full text-center text-xs font-semibold min-h-[28px]">
                    {slot.player ? (
                      <div className="font-display">
                        {slot.player.displayName}
                      </div>
                    ) : (
                      <div className="font-display text-muted">—</div>
                    )}
                  </div>
                  <div
                    className={[
                      "w-full rounded-t-lg border transition-all duration-500 ease-out font-display text-xs font-semibold text-foreground/90 flex items-center justify-center",
                      barToneClass,
                    ].join(" ")}
                    style={{ height: barHeight }}
                  >
                    {podiumLabel(slot.position)}
                  </div>
                  <div className="font-display text-sm font-semibold text-foreground min-h-[20px]">
                    {slot.player ? scoreLabel(points, hasPred) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border border-subtle bg-surface p-2">
            <button
              onClick={() => setFullPositionsExpanded((v) => !v)}
              className="w-full rounded-lg border border-teal-500 bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
            >
              {fullPositionsExpanded ? "Hide Full Room Positions" : "Show Full Room Positions"}
            </button>
            <div
              className={[
                "grid overflow-hidden transition-all duration-300 ease-out",
                fullPositionsExpanded ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0",
              ].join(" ")}
            >
              <div className="min-h-0 space-y-1">
                {rankedByTopView.map((p, i) => (
                  <div
                    key={`${topView}-rank-${p.uid}`}
                    className="flex items-center justify-between rounded-md border border-subtle px-2 py-1 text-sm"
                  >
                    <span className="font-display text-foreground">
                      {topViewRankByUid[p.uid] ?? i + 1}. {p.displayName}
                      {user?.uid === p.uid ? (
                        <span className={youPillClass()}>
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="font-display font-semibold text-foreground">
                      {scoreLabel(scoreForTopView(p.uid), hasPredForTopView(p.uid))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          className="md:hidden rounded-xl p-3 bg-surface-2 border border-teal-500"
          style={{ animationDelay: "460ms", animationDuration: "520ms" }}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => {
                if (!mobileGwOptions.length) return;
                const currentIndex =
                  mobileSelectedGwIndex >= 0 ? mobileSelectedGwIndex : 0;
                const nextIndex = Math.min(
                  mobileGwOptions.length - 1,
                  currentIndex + 1,
                );
                setSelectedTableGw(mobileGwOptions[nextIndex]);
              }}
              disabled={
                !mobileGwOptions.length ||
                mobileSelectedGwIndex < 0 ||
                mobileSelectedGwIndex >= mobileGwOptions.length - 1
              }
              className="h-9 w-9 rounded-lg border border-teal-500 bg-surface text-foreground disabled:opacity-40 inline-flex items-center justify-center p-0 leading-none"
            >
              <span className="block h-0 w-0 border-y-[6px] border-y-transparent border-r-[9px] border-r-current" />
            </button>
            <div className="relative min-w-0 flex-1">
              <label className="sr-only" htmlFor="mobile-gw-select">
                Select gameweek
              </label>
              <select
                id="mobile-gw-select"
                value={selectedTableGw}
                onChange={(e) => setSelectedTableGw(Number(e.target.value))}
                className="w-full h-9 rounded-lg border border-teal-500 bg-surface text-foreground text-sm font-semibold px-8 text-center appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {mobileGwOptions.map((gw) => (
                  <option key={gw} value={gw}>
                    GW{gw} Scores
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                ▼
              </span>
            </div>
            <button
              onClick={() => {
                if (!mobileGwOptions.length) return;
                const currentIndex =
                  mobileSelectedGwIndex >= 0 ? mobileSelectedGwIndex : 0;
                const nextIndex = Math.max(0, currentIndex - 1);
                setSelectedTableGw(mobileGwOptions[nextIndex]);
              }}
              disabled={
                !mobileGwOptions.length ||
                mobileSelectedGwIndex <= 0
              }
              className="h-9 w-9 rounded-lg border border-teal-500 bg-surface text-foreground disabled:opacity-40 inline-flex items-center justify-center p-0 leading-none"
            >
              <span className="block h-0 w-0 border-y-[6px] border-y-transparent border-l-[9px] border-l-current" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {mobileGwSortedPlayers.map((p) => {
              const pts = pointsByUserByGw?.[p.uid]?.[selectedTableGw] ?? 0;
              const hasPred = !!hasPredByUserByGw?.[p.uid]?.[selectedTableGw];
              const rank = mobileGwRankByUid[p.uid] ?? 0;
              const rankToHighlight = pts > 0 ? rank : 0;
              return (
                <div
                  key={`mobile-gw-${selectedTableGw}-${p.uid}`}
                  className={[
                    "flex items-center justify-between rounded-lg border px-3 py-2",
                    rankToHighlight === 1
                      ? "metal-glow metal-glow-gold border-yellow-400/80 bg-yellow-400/15"
                      : rankToHighlight === 2
                        ? "metal-glow metal-glow-silver border-gray-300/80 bg-gray-300/15"
                        : rankToHighlight === 3
                        ? "metal-glow metal-glow-bronze border-amber-500/80 bg-amber-500/15"
                        : "border-teal-500 bg-surface",
                  ].join(" ")}
                >
                  <div className="font-display text-sm text-foreground">
                    {rankToHighlight > 0 && rankToHighlight <= 3 ? `${rankLabel(rankToHighlight)} ` : ""}
                    {p.displayName}
                    {user?.uid === p.uid ? (
                      <span className={youPillClass()}>
                        You
                      </span>
                    ) : null}
                  </div>
                  <div className="font-display text-sm font-semibold text-foreground">
                    {scoreLabel(pts, hasPred)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="hidden md:block overflow-x-auto border border-teal-500 rounded-xl bg-surface-2"
          style={{ animationDelay: "460ms", animationDuration: "520ms" }}
        >
          <table className="w-full table-fixed text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="w-[120px] p-3 text-left border-b border-subtle text-foreground sticky left-0 bg-surface z-10"></th>
                {sortedPlayers.map((p) => (
                  <th
                    key={p.uid}
                    className="w-[120px] p-3 text-center border-b border-subtle font-semibold"
                  >
                    <span className="font-display block truncate">{p.displayName}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {weeks.map((gw) => (
                <tr
                  key={gw}
                  className={[
                    "border-b border-subtle last:border-0",
                    gw === currentGw ? "bg-blue-500/10" : "",
                  ].join(" ")}
                >
                  <td
                    className={[
                      "w-[120px] p-3 font-semibold sticky left-0 z-10",
                      gw === currentGw
                        ? "bg-blue-500/15 text-blue-300"
                        : "bg-surface-2 text-foreground",
                    ].join(" ")}
                  >
                    <span className="font-display">GW{gw}</span>
                  </td>
                  {sortedPlayers.map((p) => (
                    <td key={p.uid} className="p-3 text-center text-foreground">
                      {(() => {
                        const cellPts = pointsByUserByGw?.[p.uid]?.[gw] ?? 0;
                        const rank = gwRankByUid?.[gw]?.[p.uid] ?? 0;
                        const rankToHighlight = cellPts > 0 ? rank : 0;
                        return (
                      <span
                        className={[
                          "font-display inline-flex min-w-[44px] justify-center whitespace-nowrap rounded-md px-1.5 py-0.5",
                          rankToHighlight === 1
                            ? "metal-glow metal-glow-gold bg-yellow-400/20 border border-yellow-400/80"
                            : rankToHighlight === 2
                              ? "metal-glow metal-glow-silver bg-gray-300/20 border border-gray-300/80"
                              : rankToHighlight === 3
                                ? "metal-glow metal-glow-bronze bg-amber-500/20 border border-amber-500/80"
                                : "",
                        ].join(" ")}
                      >
                        {cellPts}
                      </span>
                        );
                      })()}
                    </td>
                  ))}
                </tr>
              ))}

            </tbody>
          </table>
        </div>

        {(gwScoreComputedAt || leaderboardRefreshedAt) && (
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-xs text-muted"
            style={{ animationDelay: "560ms", animationDuration: "520ms" }}
          >
            {gwScoreComputedAt && (
              <div>GW{currentGw} scores last calculated: {fmtDateTime(gwScoreComputedAt)}</div>
            )}
            {leaderboardRefreshedAt && (
              <div>Leaderboard last refreshed: {fmtDateTime(leaderboardRefreshedAt)}</div>
            )}
          </div>
        )}
    </PageShell>
  );
}
