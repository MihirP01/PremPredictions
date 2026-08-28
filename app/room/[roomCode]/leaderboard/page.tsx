"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { Clock3, Medal, RefreshCw, Trophy } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import SectionCard from "../../../../components/SectionCard";
import SectionGrid from "../../../../components/SectionGrid";
import SectionStack from "../../../../components/SectionStack";
import SliderSwitch from "../../../../components/SliderSwitch";
import TopActionRow from "../../../../components/TopActionRow";
import { getCurrentGameweekCached, gameweekModeFromStyle } from "@/lib/currentGameweekClient";
import { subscribeRoomPlayers } from "@/lib/liveGameBus";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import {
  getSeasonScoresSnapshotCached,
  type SeasonScoresSnapshot,
} from "@/lib/seasonScoresClient";
import {
  useCachedBootstrap,
  useCachedPlayers,
  useCachedSeasonScores,
} from "@/lib/useRoomCache";

type Player = { uid: string; displayName: string };

function buildScoreView(
  snapshot: SeasonScoresSnapshot | null,
  players: Player[],
  currentGw: number,
) {
  const pointsByUserByGw: Record<string, Record<number, number>> = {};
  const hasPredByUserByGw: Record<string, Record<number, boolean>> = {};
  const fairPlayByUserByGw: Record<string, Record<number, boolean>> = {};
  for (const player of players) {
    pointsByUserByGw[player.uid] = {};
    hasPredByUserByGw[player.uid] = {};
    fairPlayByUserByGw[player.uid] = {};
    for (let gw = 1; gw <= currentGw; gw += 1) {
      pointsByUserByGw[player.uid][gw] = 0;
      hasPredByUserByGw[player.uid][gw] = false;
      fairPlayByUserByGw[player.uid][gw] = false;
    }
  }

  if (!snapshot) {
    return {
      pointsByUserByGw,
      hasPredByUserByGw,
      fairPlayByUserByGw,
      scoredGameweeks: [] as number[],
      gwScoreComputedAt: null as Date | null,
    };
  }

  const weekByGw = new Map(snapshot.weeks.map((week) => [week.gw, week]));
  const currentWeek = weekByGw.get(currentGw);
  const gwScoreComputedAt =
    currentWeek?.computedAtMs != null
      ? new Date(currentWeek.computedAtMs)
      : null;
  const scoredWeeks = new Set<number>();
  let computedGws = snapshot.weeks
    .map((week) => week.gw)
    .filter((gw) => gw >= 1 && gw <= currentGw);
  if (computedGws.length === 0) {
    computedGws = snapshot.gameWeeks.filter(
      (gw) => gw >= 1 && gw <= currentGw,
    );
  }

  for (const gw of Array.from(new Set(computedGws)).sort((a, b) => a - b)) {
    const users = weekByGw.get(gw)?.users ?? [];
    let hasMeaningfulScore = false;
    for (const data of users) {
      const uid = String(data.uid);
      const points = Number(data.points ?? 0);
      if (!Number.isFinite(points) || !pointsByUserByGw[uid]) continue;
      const hasPrediction = Object.values(data.breakdown ?? {}).some((item) =>
        Boolean(String(item?.pred ?? "").trim()),
      );
      pointsByUserByGw[uid][gw] = points;
      hasPredByUserByGw[uid][gw] = hasPrediction;
      fairPlayByUserByGw[uid][gw] = data.fairPlayApplied === true;
      if (hasPrediction || points > 0 || data.fairPlayApplied) {
        hasMeaningfulScore = true;
      }
    }
    if (hasMeaningfulScore) scoredWeeks.add(gw);
  }

  return {
    pointsByUserByGw,
    hasPredByUserByGw,
    fairPlayByUserByGw,
    scoredGameweeks: Array.from(scoredWeeks).sort((a, b) => a - b),
    gwScoreComputedAt,
  };
}

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

function FairPlayPill({ includes = false }: { includes?: boolean }) {
  return (
    <span className="ml-1 inline-flex items-center rounded-full border border-emerald-300/20 bg-emerald-400/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-100/90 align-middle">
      {includes ? "Includes Fair Play" : "Fair Play bye"}
    </span>
  );
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
  return a.displayName.localeCompare(b.displayName, undefined, {
    sensitivity: "base",
  });
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
  const bootstrap = useCachedBootstrap(roomCode);
  const cachedPlayers = useCachedPlayers(roomCode);
  const players = useMemo<Player[]>(
    () =>
      cachedPlayers
        .map((player) => ({
          uid: player.uid,
          displayName:
            String(player.nickName || "").trim() ||
            player.displayName ||
            "Player",
        }))
        .sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, {
            sensitivity: "base",
          }),
        ),
    [cachedPlayers],
  );
  const [seasonKey, setSeasonKey] = useState(
    () => String(bootstrap?.seasonKey || ""),
  );
  const currentGw = bootstrap ? Number(bootstrap.currentGameweek) || 1 : 1;
  const gameModeStyle = String(bootstrap?.gameModeStyle || "");
  const [seasonOptions, setSeasonOptions] = useState<string[]>(() => {
    const options = Array.isArray(bootstrap?.seasonOptions)
      ? bootstrap.seasonOptions
      : [];
    const season = String(bootstrap?.seasonKey || "");
    return options.length ? options : season ? [season] : [];
  });
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshLockedUntil, setRefreshLockedUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedTableGw, setSelectedTableGw] = useState<number>(
    () => Number(bootstrap?.currentGameweek) || 1,
  );
  const [topView, setTopView] = useState<"overall" | "current" | "previous">(
    "current",
  );
  const [fullPositionsExpanded, setFullPositionsExpanded] = useState(false);
  const seasonGwSyncPrimedRef = useRef(false);
  const bootstrapRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedScores = useCachedSeasonScores(roomCode, seasonKey);
  const scoreView = useMemo(
    () => buildScoreView(cachedScores, players, currentGw),
    [cachedScores, players, currentGw],
  );
  const {
    pointsByUserByGw,
    hasPredByUserByGw,
    fairPlayByUserByGw,
    scoredGameweeks,
    gwScoreComputedAt,
  } = scoreView;
  const leaderboardRefreshedAt = cachedScores?.fetchedAtMs
    ? new Date(cachedScores.fetchedAtMs)
    : null;

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
        const options = Array.isArray(data.seasonOptions)
          ? data.seasonOptions
          : [];
        const season = String(data.seasonKey || "");
        if (!cancelled) {
          if (season && !seasonKey) setSeasonKey(season);
          setSeasonOptions(options.length ? options : season ? [season] : []);
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
        const data = await getCurrentGameweekCached(
          seasonKey,
          gameweekModeFromStyle(gameModeStyle),
        );
        const n = Number(data.currentGameweek ?? 1);
        // Cache write updates bootstrap / current GW; no local default.
      } catch {
        // keep last cached GW
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seasonKey, gameModeStyle]);

  useEffect(() => {
    setSelectedTableGw(currentGw);
  }, [currentGw]);

  useEffect(() => {
    void getRoomPlayersCached(roomCode).catch(() => {});
    return subscribeRoomPlayers(roomCode, () => {});
  }, [roomCode]);

  useEffect(() => {
    if (refreshLockedUntil <= nowMs) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [refreshLockedUntil, nowMs]);

  const loadSavedScores = useCallback(
    async (opts?: { force?: boolean }) => {
      if (players.length === 0 || !seasonKey) return;

      if (!cachedScores) setBusy(true);
      setError(null);

      try {
        await getSeasonScoresSnapshotCached(
          roomCode,
          seasonKey,
          {
            force: opts?.force === true,
          },
        );
      } catch (e) {
        setError(toErrorMessage(e, "Failed to load saved scores."));
      } finally {
        setBusy(false);
      }
    },
    [players.length, roomCode, seasonKey, cachedScores],
  );

  useEffect(() => {
    loadSavedScores().catch(() => {});
  }, [loadSavedScores]);

  // PostgreSQL is authoritative; refresh while open and immediately on resume.
  useEffect(() => {
    if (!seasonKey || players.length === 0) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        loadSavedScores({ force: true }).catch(() => {});
      }
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
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
    if (scoredGameweeks.length)
      return scoredGameweeks[scoredGameweeks.length - 1];
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

  const refreshLockSeconds = Math.max(
    0,
    Math.ceil((refreshLockedUntil - nowMs) / 1000),
  );
  const rankedByTopView = useMemo(() => {
    if (topView === "current") return currentGwSortedPlayers;
    if (topView === "previous") return previousGwSortedPlayers;
    return sortedPlayers;
  }, [topView, sortedPlayers, currentGwSortedPlayers, previousGwSortedPlayers]);
  const topThreePlayers = useMemo(
    () => rankedByTopView.slice(0, 3),
    [rankedByTopView],
  );

  const scoreForTopView = useCallback(
    (uid: string) => {
      if (topView === "current")
        return pointsByUserByGw?.[uid]?.[currentGw] ?? 0;
      if (topView === "previous")
        return pointsByUserByGw?.[uid]?.[lastScoredGw] ?? 0;
      return totalByUser[uid] ?? 0;
    },
    [topView, pointsByUserByGw, currentGw, lastScoredGw, totalByUser],
  );
  const hasPredForTopView = useCallback(
    (uid: string) => {
      if (topView === "current") return !!hasPredByUserByGw?.[uid]?.[currentGw];
      if (topView === "previous")
        return !!hasPredByUserByGw?.[uid]?.[lastScoredGw];
      return weeks.some((gw) => !!hasPredByUserByGw?.[uid]?.[gw]);
    },
    [topView, hasPredByUserByGw, currentGw, lastScoredGw, weeks],
  );
  const hasFairPlayForTopView = useCallback(
    (uid: string) => {
      if (topView === "current")
        return !!fairPlayByUserByGw?.[uid]?.[currentGw];
      if (topView === "previous")
        return !!fairPlayByUserByGw?.[uid]?.[lastScoredGw];
      return weeks.some((gw) => !!fairPlayByUserByGw?.[uid]?.[gw]);
    },
    [topView, fairPlayByUserByGw, currentGw, lastScoredGw, weeks],
  );
  const scoreLabel = useCallback(
    (score: number, hasPred: boolean) => {
      if (!cachedScores) return "—";
      return score === 0 && hasPred ? "🦆" : String(score);
    },
    [cachedScores],
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
      const rank = player
        ? (topViewRankByUid[player.uid] ?? index + 1)
        : index + 1;
      return {
        position: rank,
        player,
        tier: podiumTier(rank),
      };
    });
  }, [topThreePlayers, topViewRankByUid]);

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
        await new Promise((resolve) =>
          window.setTimeout(resolve, minSpinMs - elapsed),
        );
      }
      setRefreshing(false);
    }
  }

  const topViewLabel =
    topView === "current"
      ? `Current GW`
      : topView === "previous"
        ? `Previous GW`
        : "Season total";
  const leadingPlayer = topThreePlayers[0] ?? null;
  const leadingScore = leadingPlayer ? scoreForTopView(leadingPlayer.uid) : 0;
  const leadingHasPred = leadingPlayer
    ? hasPredForTopView(leadingPlayer.uid)
    : false;
  const standardSectionCardClass =
    "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5";
  const headerActions = (
    <div className="flex w-full items-center justify-end gap-2 sm:justify-between">
      <div className="flex items-center gap-2 sm:mr-auto">
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
    <PageShell
      width="wide"
      shellChrome={false}
      outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
      contentClassName="relative z-[1]"
    >
      <SectionStack gap="page">
        <TopActionRow
          title="Leaderboard"
          subtitle={`${roomCode} • ${seasonLabel(seasonKey || "------")}`}
          className="flex items-start justify-between gap-3 sm:items-end"
          actions={headerActions}
        />

        {error && (
          <SectionCard className={standardSectionCardClass}>
            <div className="text-sm text-rose-300">{error}</div>
          </SectionCard>
        )}

        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-1">
          <div className="rounded-[24px] border border-white/6 bg-[radial-gradient(circle_at_top_right,rgba(var(--room-accent-rgb),0.1),transparent_38%),linear-gradient(180deg,rgba(5,10,22,0.92),rgba(7,10,18,0.88))] px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/42">
                  Leaderboard desk
                </div>
                <div className="font-display text-xl font-semibold leading-tight text-foreground">
                  {topViewLabel}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="font-display text-[0.56rem] font-semibold uppercase tracking-[0.12em] text-white/52">
                    Leader
                  </div>
                  <div className="mt-0.5 truncate font-display text-[0.78rem] font-semibold text-foreground">
                    {leadingPlayer ? leadingPlayer.displayName : "—"}
                  </div>
                  <div className="mt-0.5 text-[0.62rem] leading-tight text-muted">
                    {leadingPlayer
                      ? `${scoreLabel(leadingScore, leadingHasPred)} pts`
                      : "None yet"}
                  </div>
                </div>
                <div className="rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="font-display text-[0.56rem] font-semibold uppercase tracking-[0.12em] text-white/52">
                    Week
                  </div>
                  <div className="mt-0.5 font-display text-[0.78rem] font-semibold text-foreground">
                    GW{currentGw}
                  </div>
                </div>
                <div className="rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="font-display text-[0.56rem] font-semibold uppercase tracking-[0.12em] text-white/52">
                    Last scored
                  </div>
                  <div className="mt-0.5 font-display text-[0.78rem] font-semibold text-foreground">
                    GW{medalsGw}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard className={standardSectionCardClass}>
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
                  { value: "current", label: "Current" },
                  { value: "overall", label: "Overall" },
                  { value: "previous", label: "Previous" },
                ]}
                value={topView}
                onChange={setTopView}
                className="relative grid overflow-hidden rounded-[22px] border border-white/10 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                buttonClassName="font-display relative z-10 rounded-[16px] px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors"
              />
            </div>
          </div>
        </SectionCard>

        <SectionGrid gap="page" className="xl:grid-cols-2 xl:items-start">
          <SectionCard className={standardSectionCardClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                  Podium
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-foreground">
                  {topViewLabel.toUpperCase()}
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-white/62">
                {rankedByTopView.length} players
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 items-end gap-3">
              {podiumSlots.map((slot, idx) => {
                const points = slot.player
                  ? scoreForTopView(slot.player.uid)
                  : 0;
                const hasPred = slot.player
                  ? hasPredForTopView(slot.player.uid)
                  : false;
                const hasFairPlay = slot.player
                  ? hasFairPlayForTopView(slot.player.uid)
                  : false;
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
                      {hasFairPlay ? (
                        <div className="mt-2 text-center">
                          <FairPlayPill includes={topView === "overall"} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard className={standardSectionCardClass}>
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
              className="mt-4 inline-flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-display font-semibold text-foreground transition hover:bg-white/[0.06]"
            >
              <span>
                {fullPositionsExpanded
                  ? "Collapse Full Room Positions"
                  : "Show Full Room Positions"}
              </span>
              <span
                className={[
                  "text-xs text-white/60 transition-transform duration-300 ease-out",
                  fullPositionsExpanded ? "rotate-180" : "",
                ].join(" ")}
              >
                ▾
              </span>
            </button>
            <div
              className={[
                "grid overflow-hidden transition-[grid-template-rows,opacity,transform,margin] duration-300 ease-out",
                fullPositionsExpanded
                  ? "mt-4 grid-rows-[1fr] opacity-100 translate-y-0"
                  : "mt-0 grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none",
              ].join(" ")}
            >
              <div className="min-h-0">
                <div
                  className={[
                    "space-y-2 transition-all duration-300 ease-out",
                    fullPositionsExpanded
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-1",
                  ].join(" ")}
                >
                  {rankedByTopView.map((p, i) => (
                    <div
                      key={`${topView}-rank-${p.uid}`}
                      className={[
                        "flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm transition-all duration-300 ease-out",
                        fullPositionsExpanded
                          ? "opacity-100 translate-y-0"
                          : "opacity-0 translate-y-1",
                      ].join(" ")}
                      style={{
                        transitionDelay: fullPositionsExpanded
                          ? `${Math.min(i, 8) * 32}ms`
                          : "0ms",
                      }}
                    >
                      <span className="font-display text-foreground">
                        {topViewRankByUid[p.uid] ?? i + 1}. {p.displayName}
                        {user?.uid === p.uid ? (
                          <span className={youPillClass()}>You</span>
                        ) : null}
                        {hasFairPlayForTopView(p.uid) ? (
                          <FairPlayPill includes={topView === "overall"} />
                        ) : null}
                      </span>
                      <span className="font-display font-semibold text-foreground">
                        {scoreLabel(
                          scoreForTopView(p.uid),
                          hasPredForTopView(p.uid),
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </SectionGrid>

        <SectionCard className={standardSectionCardClass}>
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
                  label=""
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
                const hasFairPlay =
                  !!fairPlayByUserByGw?.[p.uid]?.[selectedTableGw];
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
                      {rankToHighlight > 0 && rankToHighlight <= 3
                        ? `${rankLabel(rankToHighlight)} `
                        : ""}
                      {p.displayName}
                      {user?.uid === p.uid ? (
                        <span className={youPillClass()}>You</span>
                      ) : null}
                      {hasFairPlay ? <FairPlayPill /> : null}
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
                      <span className="font-display block truncate">
                        {p.displayName}
                      </span>
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
                      <td
                        key={p.uid}
                        className="p-3 text-center text-foreground"
                      >
                        {(() => {
                          const cellPts = pointsByUserByGw?.[p.uid]?.[gw] ?? 0;
                          const rank = gwRankByUid?.[gw]?.[p.uid] ?? 0;
                          const rankToHighlight = cellPts > 0 ? rank : 0;
                          const hasFairPlay =
                            !!fairPlayByUserByGw?.[p.uid]?.[gw];
                          return (
                            <span className="inline-flex flex-col items-center gap-1">
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
                              {hasFairPlay ? (
                                <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-emerald-200/85">
                                  Fair Play bye
                                </span>
                              ) : null}
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
          <SectionCard
            className={`${standardSectionCardClass} text-xs text-muted`}
          >
            <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Audit trail
            </div>
            <div className="mt-3 space-y-1">
              {gwScoreComputedAt && (
                <div>
                  GW{currentGw} scores last calculated:{" "}
                  {fmtDateTime(gwScoreComputedAt)}
                </div>
              )}
              {leaderboardRefreshedAt && (
                <div>
                  Leaderboard last refreshed:{" "}
                  {fmtDateTime(leaderboardRefreshedAt)}
                </div>
              )}
            </div>
          </SectionCard>
        )}
      </SectionStack>
    </PageShell>
  );
}
