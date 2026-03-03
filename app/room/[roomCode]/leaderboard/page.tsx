"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Clock3, Medal, RefreshCw, Trophy } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import { SettingsDropdownPanel, SettingsTriggerButton } from "../../../../components/RoomSettingsMenu";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import SectionCard from "../../../../components/SectionCard";
import SpecialBreak from "../../../../components/SpecialBreak";
import SliderSwitch from "../../../../components/SliderSwitch";
import TopActionRow from "../../../../components/TopActionRow";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { subscribeRoomMeta, subscribeRoomPlayers } from "@/lib/liveGameBus";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { getSeasonScoresSnapshotCached } from "@/lib/seasonScoresClient";
import {
  collection,
  onSnapshot,
} from "firebase/firestore";

type Player = { uid: string; displayName: string };
function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

function toErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
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

type LeaderboardSelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
};

function LeaderboardSelectField({
  id,
  label,
  value,
  onChange,
  children,
}: LeaderboardSelectFieldProps) {
  return (
    <label className="space-y-2">
      <span className="block font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
        {label}
      </span>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-2xl border border-white/8 bg-white/[0.035] px-4 pr-10 font-display text-sm font-semibold text-foreground outline-none [text-align-last:left] backdrop-blur-sm"
        >
          {children}
        </select>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[0.72rem] text-white/45">
          ▼
        </span>
      </div>
    </label>
  );
}

type SummaryTileProps = {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  icon?: React.ReactNode;
};

function SummaryTile({ label, value, note, icon }: SummaryTileProps) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-4 shadow-[0_14px_32px_rgba(3,8,20,0.14)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/46">
            {label}
          </div>
          <div className="font-display text-[clamp(1.05rem,1.8vw,1.65rem)] font-semibold leading-none text-foreground">
            {value}
          </div>
        </div>
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/75">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-3 text-xs text-muted">{note}</div>
    </div>
  );
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
  const [refreshing, setRefreshing] = useState(false);
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
  const settingsWrapDesktopRef = useRef<HTMLDivElement | null>(null);
  const seasonGwSyncPrimedRef = useRef(false);
  const bootstrapRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const loadBootstrap = async () => {
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

  const loadSavedScores = useCallback(async (opts?: { force?: boolean }) => {
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
      const snapshot = await getSeasonScoresSnapshotCached(roomCode, seasonKey, {
        force: opts?.force === true,
      });
      const weekByGw = new Map(snapshot.weeks.map((w) => [w.gw, w]));
      let currentGwComputedAt: Date | null = null;
      const currentWeek = weekByGw.get(currentGw);
      if (currentWeek?.computedAtMs != null) {
        currentGwComputedAt = new Date(currentWeek.computedAtMs);
      }

      // "Scored" means we actually have per-user score docs for that GW.
      // Do not infer scored weeks from summary doc ids alone.
      const scoredWeeks = new Set<number>();

      let computedGws = snapshot.weeks
        .map((w) => w.gw)
        .filter((n) => n >= 1 && n <= currentGw);

      // If no score summaries, derive candidate weeks from seasonal games.
      if (computedGws.length === 0) {
        computedGws = snapshot.gameWeeks.filter((n) => n >= 1 && n <= currentGw);
      }

      computedGws = Array.from(new Set(computedGws)).sort((a, b) => a - b);

      for (const gw of computedGws) {
        const users = weekByGw.get(gw)?.users ?? [];
        let gwHasMeaningfulScore = false;
        for (const data of users) {
          const uid = String(data.uid);
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

  // Live refresh when score docs change (e.g. recalc/cron writes).
  useEffect(() => {
    if (!seasonKey || players.length === 0) return;
    const scoresRef = collection(db, "rooms", roomCode, "seasons", seasonKey, "scores");
    const unsub = onSnapshot(
      scoresRef,
      () => {
        loadSavedScores().catch(() => {});
      },
      () => {},
    );
    return () => unsub();
  }, [roomCode, seasonKey, players.length, loadSavedScores]);

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

      await loadSavedScores({ force: true });
    } catch (e) {
      setError(toErrorMessage(e, "Failed to recalculate saved scores."));
    } finally {
      setLeaderToolBusy(false);
    }
  }

  async function refreshLeaderboard() {
    if (busy || refreshing || refreshLockSeconds > 0) return;
    const startedAt = Date.now();
    setRefreshing(true);
    setRefreshLockedUntil(Date.now() + 10_000);
    setNowMs(Date.now());
    try {
      await loadSavedScores({ force: true });
    } finally {
      const elapsed = Date.now() - startedAt;
      const minSpinMs = 450;
      if (elapsed < minSpinMs) {
        await new Promise((resolve) => window.setTimeout(resolve, minSpinMs - elapsed));
      }
      setRefreshing(false);
    }
  }

  const topViewLabel =
    topView === "current"
      ? `Gameweek ${currentGw}`
      : topView === "previous"
        ? `Gameweek ${medalsGw}`
        : "Season total";
  const leadingPlayer = topThreePlayers[0] ?? null;
  const leadingScore = leadingPlayer ? scoreForTopView(leadingPlayer.uid) : 0;
  const leadingHasPred = leadingPlayer ? hasPredForTopView(leadingPlayer.uid) : false;
  const headerActions = (
    <div className="flex w-full items-center justify-end gap-2 sm:justify-between">
      <div className="flex items-center gap-2 sm:mr-auto">
        {isLeader && (
          <div ref={settingsWrapDesktopRef} className="relative z-[120]">
            <SettingsTriggerButton onClick={() => setSettingsOpen((v) => !v)} />
            <SettingsDropdownPanel open={settingsOpen} className="!left-auto !right-0 !z-[140]">
              <div className="font-display font-semibold text-foreground">Leader Tools</div>
              <div className="space-y-2">
                <div className="text-xs text-muted">
                  Recalculate score docs, then reload leaderboard data.
                </div>
                <button
                  onClick={recalcAndRefreshScores}
                  disabled={leaderToolBusy}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-display font-semibold text-foreground transition hover:bg-white/[0.06] disabled:opacity-60"
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
          disabled={busy || refreshing || refreshLockSeconds > 0}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.16)] transition hover:bg-white/[0.06] disabled:opacity-60"
          aria-label="Refresh leaderboard"
          title={
            refreshLockSeconds > 0
              ? `Refresh locked (${refreshLockSeconds}s)`
              : "Refresh leaderboard"
          }
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="hidden sm:flex">
        <PageBackButton onClick={() => router.push(`/room/${roomCode}`)} />
      </div>
    </div>
  );
  return (
    <PageShell>
      <div className="space-y-3">
        <TopActionRow
          title="Leaderboard"
          subtitle={`${roomCode} • ${seasonLabel(seasonKey || "----")}`}
          actions={headerActions}
        />
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
              {!!seasonOptions.length && (
                <LeaderboardSelectField
                  id="leaderboard-season-select"
                  label="Season"
                  value={seasonKey}
                  onChange={setSeasonKey}
                >
                  {seasonOptions.map((s) => (
                    <option key={s} value={s}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </LeaderboardSelectField>
              )}
              <div className="space-y-2">
                <div className="block font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                  Focus
                </div>
                <SliderSwitch
                  options={[
                    { value: "overall", label: "Overall" },
                    { value: "current", label: `GW${currentGw}` },
                    { value: "previous", label: `GW${medalsGw}` },
                  ]}
                  value={topView}
                  onChange={setTopView}
                  className="relative grid overflow-hidden rounded-[22px] border border-white/10 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  buttonClassName="font-display relative z-10 rounded-[16px] px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors"
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(255,255,255,0.03)_38%,rgba(56,189,248,0.05)_100%)] p-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="space-y-3">
                  <div className="font-display text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-white/48">
                    {topViewLabel}
                  </div>
                  <div className="font-display text-[clamp(1.85rem,3vw,3rem)] font-semibold leading-[0.95] text-foreground">
                    Top three snapshot
                  </div>
                  <div className="max-w-2xl text-sm text-muted">
                    A room-wide editorial view of current leaders, point separation, and the standing that matters for this scoring lens.
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <SummaryTile
                    label="Leader"
                    value={leadingPlayer ? leadingPlayer.displayName : "—"}
                    note={
                      leadingPlayer
                        ? `${scoreLabel(leadingScore, leadingHasPred)} points in ${topViewLabel.toLowerCase()}`
                        : "No scored entries yet"
                    }
                    icon={<Trophy size={16} />}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <SummaryTile
                label="Current Week"
                value={`GW${currentGw}`}
                note={scoredGameweeks.includes(currentGw) ? "Score docs saved for this round." : "Waiting on saved score docs."}
                icon={<Medal size={16} />}
              />
              <SummaryTile
                label="Last Scored"
                value={`GW${medalsGw}`}
                note="Used as the previous podium comparison."
                icon={<Clock3 size={16} />}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SpecialBreak />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                Podium
              </div>
              <div className="mt-1 font-display text-xl font-semibold text-foreground">
                Top three for {topViewLabel.toLowerCase()}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-white/62">
              {rankedByTopView.length} players
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 items-end gap-3">
            {podiumSlots.map((slot, idx) => {
              const points = slot.player ? scoreForTopView(slot.player.uid) : 0;
              const hasPred = slot.player ? hasPredForTopView(slot.player.uid) : false;
              const barHeight =
                slot.tier === "gold"
                  ? "132px"
                  : slot.tier === "silver"
                    ? "108px"
                    : "86px";
              const toneShell =
                slot.tier === "gold"
                  ? "border-yellow-400/55 bg-[linear-gradient(180deg,rgba(250,204,21,0.22),rgba(255,255,255,0.02))]"
                  : slot.tier === "silver"
                    ? "border-slate-300/45 bg-[linear-gradient(180deg,rgba(203,213,225,0.18),rgba(255,255,255,0.02))]"
                    : "border-amber-500/50 bg-[linear-gradient(180deg,rgba(245,158,11,0.18),rgba(255,255,255,0.02))]";
              const toneBar =
                slot.tier === "gold"
                  ? "metal-glow metal-glow-gold border-yellow-400/80 bg-[linear-gradient(180deg,rgba(250,204,21,0.36),rgba(250,204,21,0.14))]"
                  : slot.tier === "silver"
                    ? "metal-glow metal-glow-silver border-slate-200/80 bg-[linear-gradient(180deg,rgba(203,213,225,0.32),rgba(203,213,225,0.12))]"
                    : "metal-glow metal-glow-bronze border-amber-500/80 bg-[linear-gradient(180deg,rgba(245,158,11,0.34),rgba(245,158,11,0.12))]";
              return (
                <div key={`podium-slot-${idx}`} className="space-y-2">
                  <div className="min-h-[2.75rem] px-1 text-center">
                    {slot.player ? (
                      <div className="font-display text-sm font-semibold leading-tight text-foreground">
                        {slot.player.displayName}
                      </div>
                    ) : (
                      <div className="font-display text-sm text-muted">—</div>
                    )}
                  </div>
                  <div className={`rounded-[22px] border p-3 ${toneShell}`}>
                    <div
                      className={[
                        "flex w-full items-center justify-center rounded-[18px] border font-display text-base font-semibold text-foreground transition-all duration-500 ease-out",
                        toneBar,
                      ].join(" ")}
                      style={{ height: barHeight }}
                    >
                      {podiumLabel(slot.position)}
                    </div>
                    <div className="mt-3 text-center font-display text-xl font-semibold text-foreground">
                      {slot.player ? scoreLabel(points, hasPred) : "—"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
          <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
            Full standings
          </div>
          <div className="mt-1 font-display text-xl font-semibold text-foreground">
            Room positions
          </div>
          <div className="mt-2 text-sm text-muted">
            Expand the full ranking ladder for the active leaderboard lens.
          </div>
          <button
            onClick={() => setFullPositionsExpanded((v) => !v)}
            className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-display font-semibold text-foreground transition hover:bg-white/[0.06]"
          >
            {fullPositionsExpanded ? "Hide Full Room Positions" : "Show Full Room Positions"}
          </button>
          <div
            className={[
              "grid overflow-hidden transition-all duration-300 ease-out",
              fullPositionsExpanded
                ? "grid-rows-[1fr] opacity-100 mt-4"
                : "grid-rows-[0fr] opacity-0 mt-0",
            ].join(" ")}
          >
            <div className="min-h-0 space-y-2">
              {rankedByTopView.map((p, i) => (
                <div
                  key={`${topView}-rank-${p.uid}`}
                  className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm"
                >
                  <span className="font-display text-foreground">
                    {topViewRankByUid[p.uid] ?? i + 1}. {p.displayName}
                    {user?.uid === p.uid ? <span className={youPillClass()}>You</span> : null}
                  </span>
                  <span className="font-display font-semibold text-foreground">
                    {scoreLabel(scoreForTopView(p.uid), hasPredForTopView(p.uid))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Gameweek matrix
            </div>
            <div className="mt-1 font-display text-xl font-semibold text-foreground">
              Compare weekly scoring across the room
            </div>
          </div>
          <div className="hidden rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-white/62 md:flex">
            Through GW{currentGw}
          </div>
        </div>

        <div className="mt-5 rounded-[22px] border border-white/8 bg-white/[0.02] p-3 md:hidden">
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.12)] disabled:opacity-40"
            >
              <span className="block h-0 w-0 border-y-[6px] border-y-transparent border-r-[9px] border-r-current" />
            </button>
            <div className="min-w-0 flex-1">
              <LeaderboardSelectField
                id="mobile-gw-select"
                label="Mobile view"
                value={String(selectedTableGw)}
                onChange={(value) => setSelectedTableGw(Number(value))}
              >
                {mobileGwOptions.map((gw) => (
                  <option key={gw} value={String(gw)}>
                    GW {gw} Scores
                  </option>
                ))}
              </LeaderboardSelectField>
            </div>
            <button
              onClick={() => {
                if (!mobileGwOptions.length) return;
                const currentIndex =
                  mobileSelectedGwIndex >= 0 ? mobileSelectedGwIndex : 0;
                const nextIndex = Math.max(0, currentIndex - 1);
                setSelectedTableGw(mobileGwOptions[nextIndex]);
              }}
              disabled={!mobileGwOptions.length || mobileSelectedGwIndex <= 0}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.12)] disabled:opacity-40"
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
                    "flex items-center justify-between rounded-2xl border px-3 py-2.5",
                    rankToHighlight === 1
                      ? "metal-glow metal-glow-gold border-yellow-400/80 bg-yellow-400/15"
                      : rankToHighlight === 2
                        ? "metal-glow metal-glow-silver border-gray-300/80 bg-gray-300/15"
                        : rankToHighlight === 3
                          ? "metal-glow metal-glow-bronze border-amber-500/80 bg-amber-500/15"
                          : "border-white/8 bg-white/[0.02]",
                  ].join(" ")}
                >
                  <div className="font-display text-sm text-foreground">
                    {rankToHighlight > 0 && rankToHighlight <= 3 ? `${rankLabel(rankToHighlight)} ` : ""}
                    {p.displayName}
                    {user?.uid === p.uid ? <span className={youPillClass()}>You</span> : null}
                  </div>
                  <div className="font-display text-sm font-semibold text-foreground">
                    {scoreLabel(pts, hasPred)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 hidden overflow-x-auto rounded-[22px] border border-white/8 bg-white/[0.02] md:block">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-black/10">
              <tr>
                <th className="sticky left-0 z-10 w-[120px] border-b border-subtle bg-black/10 p-3 text-left text-foreground"></th>
                {sortedPlayers.map((p) => (
                  <th
                    key={p.uid}
                    className="w-[120px] border-b border-subtle p-3 text-center font-semibold"
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
                    gw === currentGw ? "bg-sky-400/8" : "",
                  ].join(" ")}
                >
                  <td
                    className={[
                      "sticky left-0 z-10 w-[120px] p-3 font-semibold",
                      gw === currentGw
                        ? "bg-sky-400/10 text-sky-200"
                        : "bg-white/[0.02] text-foreground",
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
      </SectionCard>

      {(gwScoreComputedAt || leaderboardRefreshedAt) && (
        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 text-xs text-muted">
          <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
            Audit trail
          </div>
          <div className="mt-3 space-y-1">
            {gwScoreComputedAt && (
              <div>GW{currentGw} scores last calculated: {fmtDateTime(gwScoreComputedAt)}</div>
            )}
            {leaderboardRefreshedAt && (
              <div>Leaderboard last refreshed: {fmtDateTime(leaderboardRefreshedAt)}</div>
            )}
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
