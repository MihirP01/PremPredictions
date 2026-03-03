"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Loader2,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trophy,
} from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import SectionCard from "../../../../components/SectionCard";
import SpecialBreak from "../../../../components/SpecialBreak";
import TopActionRow from "../../../../components/TopActionRow";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { subscribeRoomPlayers } from "@/lib/liveGameBus";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import {
  getSeasonScoresSnapshotCached,
  type SeasonScoresSnapshot,
} from "@/lib/seasonScoresClient";

type Player = { uid: string; displayName: string };
type ScoreDoc = {
  points?: number;
  breakdown?: Record<
    string,
    {
      base?: number;
      golden?: boolean;
      powerupType?: "ALL_IN" | "SAFETY_NET" | null;
      total?: number;
      pred?: string | null;
      actual?: string | null;
    }
  >;
};
function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

type PlayerStats = {
  totalPoints: number;
  exactCount: number;
  resultOnlyCount: number;
  totalGradedPicks: number;
  goldenBonusPoints: number;
  powerupPointsGained: number;
  powerupPointsLost: number;
  powerupUsage: { ALL_IN: number; SAFETY_NET: number };
  goldenPickCount: number;
  goalDisparity: number;
  outcomeAttempts: { H: number; D: number; A: number };
  outcomeHits: { H: number; D: number; A: number };
  bestGw: number | null;
  bestGwPoints: number;
  byGw: Record<number, number>;
  byGwBreakdown: Record<
    number,
    {
      points: number;
      exactCount: number;
      resultOnlyCount: number;
      totalGradedPicks: number;
      goldenBonusPoints: number;
      powerupPointsGained: number;
      powerupPointsLost: number;
      powerupUsage: { ALL_IN: number; SAFETY_NET: number };
      goldenPickCount: number;
      goalDisparity: number;
      outcomeAttempts: { H: number; D: number; A: number };
      outcomeHits: { H: number; D: number; A: number };
    }
  >;
};

function projectStatsForGw(
  source: PlayerStats | null | undefined,
  selectedGwNumber: number | null,
): PlayerStats | null {
  if (!source) return null;
  if (selectedGwNumber == null) return source;
  const gwStats = source.byGwBreakdown[selectedGwNumber];
  const gwPoints = source.byGw[selectedGwNumber] ?? 0;
  return {
    ...source,
    totalPoints: gwPoints,
    exactCount: gwStats?.exactCount ?? 0,
    resultOnlyCount: gwStats?.resultOnlyCount ?? 0,
    totalGradedPicks: gwStats?.totalGradedPicks ?? 0,
    goldenBonusPoints: gwStats?.goldenBonusPoints ?? 0,
    powerupPointsGained: gwStats?.powerupPointsGained ?? 0,
    powerupPointsLost: gwStats?.powerupPointsLost ?? 0,
    powerupUsage: gwStats?.powerupUsage ?? { ALL_IN: 0, SAFETY_NET: 0 },
    goldenPickCount: gwStats?.goldenPickCount ?? 0,
    goalDisparity: gwStats?.goalDisparity ?? 0,
    outcomeAttempts: gwStats?.outcomeAttempts ?? { H: 0, D: 0, A: 0 },
    outcomeHits: gwStats?.outcomeHits ?? { H: 0, D: 0, A: 0 },
    bestGw: gwStats ? selectedGwNumber : null,
    bestGwPoints: gwStats ? gwPoints : 0,
  } satisfies PlayerStats;
}

function fmtDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function outcome(score: string) {
  const m = String(score).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (h > a) return "H" as const;
  if (h < a) return "A" as const;
  return "D" as const;
}

function totalGoals(score: string) {
  const m = String(score).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return h + a;
}

function mostUsedPowerupLabel(usage: { ALL_IN: number; SAFETY_NET: number }) {
  const allIn = usage.ALL_IN ?? 0;
  const safety = usage.SAFETY_NET ?? 0;
  if (allIn === 0 && safety === 0) return "None";
  if (allIn === safety) return "All-In / Safety Net";
  return allIn > safety ? "All-In" : "Safety Net";
}

function signedValue(value: number) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "0";
}

function metricTone(rank: number) {
  if (rank === 1) {
    return {
      shell:
        "border-yellow-400/55 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(15,23,42,0.62))] shadow-[0_14px_32px_rgba(245,158,11,0.08)]",
      badge: "text-yellow-200 bg-yellow-400/12 border-yellow-300/25",
    };
  }
  if (rank === 2) {
    return {
      shell:
        "border-slate-300/40 bg-[linear-gradient(135deg,rgba(148,163,184,0.14),rgba(15,23,42,0.62))] shadow-[0_14px_32px_rgba(148,163,184,0.08)]",
      badge: "text-slate-100 bg-slate-300/12 border-slate-300/20",
    };
  }
  if (rank === 3) {
    return {
      shell:
        "border-amber-500/45 bg-[linear-gradient(135deg,rgba(180,83,9,0.14),rgba(15,23,42,0.62))] shadow-[0_14px_32px_rgba(180,83,9,0.08)]",
      badge: "text-amber-100 bg-amber-500/12 border-amber-400/20",
    };
  }
  return {
    shell:
      "border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_14px_32px_rgba(3,8,20,0.14)]",
    badge: "text-white/70 bg-white/[0.03] border-white/8",
  };
}

type StatsSelectFieldProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
};

function StatsSelectField({
  id,
  label,
  value,
  onChange,
  children,
}: StatsSelectFieldProps) {
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
          className="w-full h-12 rounded-2xl border border-white/8 bg-white/[0.035] px-4 pr-10 font-display text-sm font-semibold text-foreground outline-none appearance-none [text-align-last:left] backdrop-blur-sm"
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

type MetricTileProps = {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  rank?: number;
  icon?: React.ReactNode;
};

function MetricTile({ label, value, note, rank = 0, icon }: MetricTileProps) {
  const tone = metricTone(rank);
  return (
    <div className={`rounded-[22px] border p-4 ${tone.shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
            {label}
          </div>
          <div className="font-display text-[clamp(1.25rem,2vw,1.9rem)] font-semibold leading-none text-foreground">
            {value}
          </div>
        </div>
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/75">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-h-[1.25rem] text-xs text-muted">{note ?? "\u00a0"}</div>
        {rank > 0 ? (
          <div className={`rounded-full border px-2.5 py-1 font-display text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${tone.badge}`}>
            Rank #{rank}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function RoomStatsPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>("");
  const [selectedGwFilter, setSelectedGwFilter] = useState<string>("all");
  const [currentGw, setCurrentGw] = useState<number>(1);
  const [seasonKey, setSeasonKey] = useState<string>("");
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasonSnapshot, setSeasonSnapshot] = useState<SeasonScoresSnapshot | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const seasonGwSyncPrimedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, user, router]);

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
    let cancelled = false;
    (async () => {
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cancelled || !cached?.length) return;
        const seeded: Player[] = cached
          .map((p) => ({
            uid: p.uid,
            displayName: String(p.nickName || "").trim() || p.displayName || "Player",
          }))
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
          );
        setPlayers(seeded);
      } catch {
        // ignore
      }
    })();
    const unsub = subscribeRoomPlayers(
      roomCode,
      (livePlayers) => {
        const list = livePlayers
          .map((player) => {
            const nick = String(player.nickName || "").trim();
            return {
              uid: player.uid,
              displayName: nick || player.displayName || "Player",
            } satisfies Player;
          })
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
          );
        setPlayers(list);
      },
      () => setError("Failed to load room players."),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [roomCode]);

  const effectiveSelectedUid = useMemo(() => {
    if (selectedUid && players.some((p) => p.uid === selectedUid)) return selectedUid;
    if (user && players.some((p) => p.uid === user.uid)) return user.uid;
    return players[0]?.uid ?? "";
  }, [players, selectedUid, user]);

  useEffect(() => {
    if (!seasonKey) {
      setSeasonSnapshot(null);
      setLastUpdated(null);
      return;
    }

    let cancelled = false;
    (async () => {
      if (!cancelled) {
        setBusy(true);
        setError(null);
      }
      const snapshot = await getSeasonScoresSnapshotCached(roomCode, seasonKey);
      let latestComputedAtMs: number | null = null;
      for (const week of snapshot.weeks) {
        if (
          week.computedAtMs != null &&
          (latestComputedAtMs == null || week.computedAtMs > latestComputedAtMs)
        ) {
          latestComputedAtMs = week.computedAtMs;
        }
      }

      if (!cancelled) {
        setSeasonSnapshot(snapshot);
        setLastUpdated(latestComputedAtMs != null ? new Date(latestComputedAtMs) : null);
        setError(null);
      }
    })()
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load player stats.");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [roomCode, seasonKey]);

  const statsByUid = useMemo(() => {
    if (players.length === 0 || !seasonSnapshot) return {};

    const playerSet = new Set(players.map((p) => p.uid));
    const baseStats: Record<string, PlayerStats> = {};
    for (const p of players) {
      baseStats[p.uid] = {
        totalPoints: 0,
        exactCount: 0,
        resultOnlyCount: 0,
        totalGradedPicks: 0,
        goldenBonusPoints: 0,
        powerupPointsGained: 0,
        powerupPointsLost: 0,
        powerupUsage: { ALL_IN: 0, SAFETY_NET: 0 },
        goldenPickCount: 0,
        goalDisparity: 0,
        outcomeAttempts: { H: 0, D: 0, A: 0 },
        outcomeHits: { H: 0, D: 0, A: 0 },
        bestGw: null,
        bestGwPoints: 0,
        byGw: {},
        byGwBreakdown: {},
      };
    }

    const weekByGw = new Map(seasonSnapshot.weeks.map((w) => [w.gw, w]));
    const gws = seasonSnapshot.weeks
      .map((w) => w.gw)
      .filter((n) => n >= 1 && n <= currentGw)
      .sort((a, b) => a - b);

    for (const gw of gws) {
      const users = weekByGw.get(gw)?.users ?? [];

      for (const userScoreDoc of users) {
        const uid = String(userScoreDoc.uid);
        if (!playerSet.has(uid)) continue;

        const score = userScoreDoc as ScoreDoc;
        const points = Number(score.points ?? 0);
        const s = baseStats[uid];
        if (!s) continue;

        s.totalPoints += Number.isFinite(points) ? points : 0;
        s.byGw[gw] = Number.isFinite(points) ? points : 0;
        if (!s.byGwBreakdown[gw]) {
          s.byGwBreakdown[gw] = {
            points: 0,
            exactCount: 0,
            resultOnlyCount: 0,
            totalGradedPicks: 0,
            goldenBonusPoints: 0,
            powerupPointsGained: 0,
            powerupPointsLost: 0,
            powerupUsage: { ALL_IN: 0, SAFETY_NET: 0 },
            goldenPickCount: 0,
            goalDisparity: 0,
            outcomeAttempts: { H: 0, D: 0, A: 0 },
            outcomeHits: { H: 0, D: 0, A: 0 },
          };
        }
        const gwStats = s.byGwBreakdown[gw];
        gwStats.points = Number.isFinite(points) ? points : 0;

        if (s.bestGw == null || points > s.bestGwPoints) {
          s.bestGw = gw;
          s.bestGwPoints = points;
        }

        const breakdown = score.breakdown ?? {};
        for (const item of Object.values(breakdown)) {
          if (item.pred != null && String(item.pred).trim() !== "") {
            s.totalGradedPicks += 1;
            gwStats.totalGradedPicks += 1;
          }
          if (item.base === 2) {
            s.exactCount += 1;
            gwStats.exactCount += 1;
          } else if (item.base === 1) {
            s.resultOnlyCount += 1;
            gwStats.resultOnlyCount += 1;
          }
          if (item.golden) {
            s.goldenPickCount += 1;
            gwStats.goldenPickCount += 1;
            const base = Number(item.base ?? 0);
            if (Number.isFinite(base) && base > 0) {
              s.goldenBonusPoints += base;
              gwStats.goldenBonusPoints += base;
            }
          }

          const multiplier = item.golden ? 2 : 1;
          const nonPowerupPoints = Number(item.base ?? 0) * multiplier;
          const fixtureTotalPoints = Number(item.total ?? nonPowerupPoints);
          const powerupType = item.powerupType ?? null;
          if (powerupType === "ALL_IN" || powerupType === "SAFETY_NET") {
            const delta = fixtureTotalPoints - nonPowerupPoints;
            if (delta > 0) {
              s.powerupPointsGained += delta;
              gwStats.powerupPointsGained += delta;
            } else if (delta < 0) {
              const loss = Math.abs(delta);
              s.powerupPointsLost += loss;
              gwStats.powerupPointsLost += loss;
            }
            s.powerupUsage[powerupType] += 1;
            gwStats.powerupUsage[powerupType] += 1;
          }

          const predOutcome = item.pred ? outcome(item.pred) : null;
          const actualOutcome = item.actual ? outcome(String(item.actual)) : null;
          if (predOutcome && actualOutcome) {
            s.outcomeAttempts[predOutcome] += 1;
            gwStats.outcomeAttempts[predOutcome] += 1;
            if (predOutcome === actualOutcome) {
              s.outcomeHits[predOutcome] += 1;
              gwStats.outcomeHits[predOutcome] += 1;
            }
          }

          const predGoals = item.pred ? totalGoals(item.pred) : null;
          const actualGoals = item.actual ? totalGoals(String(item.actual)) : null;
          if (predGoals != null && actualGoals != null) {
            s.goalDisparity += predGoals - actualGoals;
            gwStats.goalDisparity += predGoals - actualGoals;
          }
        }
      }
    }

    return baseStats;
  }, [players, seasonSnapshot, currentGw]);

  const selectedPlayer = players.find((p) => p.uid === effectiveSelectedUid) ?? null;
  const stats = effectiveSelectedUid ? statsByUid[effectiveSelectedUid] : null;
  const allScoredGws = useMemo(() => {
    const set = new Set<number>();
    Object.values(statsByUid).forEach((s) => {
      Object.keys(s.byGw).forEach((k) => {
        const n = Number(k);
        if (Number.isFinite(n)) set.add(n);
      });
    });
    return [...set].sort((a, b) => b - a);
  }, [statsByUid]);
  const effectiveGwFilter =
    selectedGwFilter === "all" || allScoredGws.includes(Number(selectedGwFilter))
      ? selectedGwFilter
      : "all";
  const selectedGwNumber =
    effectiveGwFilter === "all"
      ? null
      : Number.isFinite(Number(effectiveGwFilter))
        ? Number(effectiveGwFilter)
        : null;
  const displayStats = projectStatsForGw(stats, selectedGwNumber);

  const rankMapByMetric = useMemo(() => {
    const displayByUid: Record<string, PlayerStats> = {};
    players.forEach((p) => {
      const s = projectStatsForGw(statsByUid[p.uid], selectedGwNumber);
      if (s) displayByUid[p.uid] = s;
    });
    const competitionRank = (
      metric: (uid: string) => number,
      asc = false,
    ): Record<string, number> => {
      const ordered = [...players].sort((a, b) => {
        const av = metric(a.uid);
        const bv = metric(b.uid);
        if (av !== bv) return asc ? av - bv : bv - av;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      });
      const out: Record<string, number> = {};
      let prev: number | null = null;
      let rank = 0;
      ordered.forEach((p, index) => {
        const v = metric(p.uid);
        if (prev === null || v !== prev) rank = index + 1;
        out[p.uid] = rank;
        prev = v;
      });
      return out;
    };
    return {
      totalPoints: competitionRank((uid) => displayByUid[uid]?.totalPoints ?? 0),
      bestGwPoints: competitionRank((uid) => displayByUid[uid]?.bestGwPoints ?? 0),
      exactCount: competitionRank((uid) => displayByUid[uid]?.exactCount ?? 0),
      correctResults: competitionRank((uid) => {
        const s = displayByUid[uid];
        return (s?.exactCount ?? 0) + (s?.resultOnlyCount ?? 0);
      }),
      goalDisparity: competitionRank((uid) => Math.abs(displayByUid[uid]?.goalDisparity ?? 0), true),
      goldenBonus: competitionRank((uid) => displayByUid[uid]?.goldenBonusPoints ?? 0),
      powerupGain: competitionRank((uid) => displayByUid[uid]?.powerupPointsGained ?? 0),
      powerupLoss: competitionRank((uid) => displayByUid[uid]?.powerupPointsLost ?? 0, true),
    };
  }, [players, statsByUid, selectedGwNumber]);
  const recentGws =
    Array.from({ length: Math.min(5, currentGw) }, (_, i) => currentGw - i);
  if (loading || !user) return null;

  const scopedLabel =
    selectedGwNumber == null ? "Season to date" : `Gameweek ${selectedGwNumber} snapshot`;
  const correctResultsTotal =
    (displayStats?.exactCount ?? 0) + (displayStats?.resultOnlyCount ?? 0);
  const exactRate = pct(displayStats?.exactCount ?? 0, displayStats?.totalGradedPicks ?? 0);
  const correctRate = pct(correctResultsTotal, displayStats?.totalGradedPicks ?? 0);
  const roomRank = rankMapByMetric.totalPoints[effectiveSelectedUid] ?? Math.max(players.length, 1);
  const bestGwRank = rankMapByMetric.bestGwPoints[effectiveSelectedUid] ?? 0;
  const exactRank = rankMapByMetric.exactCount[effectiveSelectedUid] ?? 0;
  const correctRank = rankMapByMetric.correctResults[effectiveSelectedUid] ?? 0;
  const goldenRank = rankMapByMetric.goldenBonus[effectiveSelectedUid] ?? 0;
  const gainRank = rankMapByMetric.powerupGain[effectiveSelectedUid] ?? 0;
  const lossRank = rankMapByMetric.powerupLoss[effectiveSelectedUid] ?? 0;
  const disparityRank = rankMapByMetric.goalDisparity[effectiveSelectedUid] ?? 0;

  return (
    <PageShell>
      <div className="space-y-3">
        <TopActionRow
          title="Player Stats"
          subtitle={`${roomCode} • ${seasonLabel(seasonKey || "----")}`}
          actions={<PageBackButton onClick={() => router.push(`/room/${roomCode}`)} />}
        />
      </div>

      <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {!!seasonOptions.length && (
                <StatsSelectField
                  id="stats-season-select"
                  label="Season"
                  value={seasonKey}
                  onChange={setSeasonKey}
                >
                  {seasonOptions.map((s) => (
                    <option key={s} value={s}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </StatsSelectField>
              )}
              <StatsSelectField
                label="Player"
                value={effectiveSelectedUid}
                onChange={setSelectedUid}
              >
                {players.map((p) => (
                  <option className="font-display" key={p.uid} value={p.uid}>
                    {p.displayName}
                  </option>
                ))}
              </StatsSelectField>
              <StatsSelectField
                id="stats-gw-filter-select"
                label="Scope"
                value={effectiveGwFilter}
                onChange={setSelectedGwFilter}
              >
                <option value="all">All GWs</option>
                {allScoredGws.map((gw) => (
                  <option key={`gw-filter-${gw}`} value={String(gw)}>
                    GW {gw}
                  </option>
                ))}
              </StatsSelectField>
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : busy ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-4 text-sm text-muted inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading stats…</span>
              </div>
            ) : !selectedPlayer || !displayStats ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-4 text-sm text-muted">
                No player stats available yet.
              </div>
            ) : (
              <>
                <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(255,255,255,0.03)_38%,rgba(56,189,248,0.05)_100%)] p-5">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.95fr)]">
                    <div className="space-y-3">
                      <div className="font-display text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-white/48">
                        {scopedLabel}
                      </div>
                      <div className="font-display text-[clamp(1.9rem,3vw,3.1rem)] font-semibold leading-[0.95] text-foreground">
                        {selectedPlayer.displayName}
                      </div>
                      <div className="max-w-2xl text-sm text-muted">
                        A compact editorial view of scoring output, prediction accuracy, power-up swing, and weekly form.
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                        <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/46">
                          Room Ranking
                        </div>
                        <div className="mt-2 font-display text-2xl font-semibold text-foreground">
                          #{roomRank}/{players.length || 1}
                        </div>
                        <div className="mt-2 text-xs text-muted">Standing in the current scope.</div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                        <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/46">
                          Most Used
                        </div>
                        <div className="mt-2 font-display text-lg font-semibold text-foreground">
                          {mostUsedPowerupLabel(displayStats.powerupUsage)}
                        </div>
                        <div className="mt-2 text-xs text-muted">Preferred chip usage pattern.</div>
                      </div>
                    </div>
                  </div>
                </div>

                <SpecialBreak />

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label="Total Points"
                    value={displayStats.totalPoints}
                    note={`${correctResultsTotal} correct outcomes from ${displayStats.totalGradedPicks} graded picks`}
                    rank={roomRank}
                    icon={<Trophy size={16} />}
                  />
                  <MetricTile
                    label="Best Gameweek"
                    value={displayStats.bestGw ? `GW${displayStats.bestGw}` : "-"}
                    note={
                      displayStats.bestGw
                        ? `${displayStats.bestGwPoints} points in the strongest single week`
                        : "No scored gameweek yet"
                    }
                    rank={bestGwRank}
                    icon={<Sparkles size={16} />}
                  />
                  <MetricTile
                    label="Exact Scores"
                    value={`${displayStats.exactCount}`}
                    note={`${exactRate} exact hit rate`}
                    rank={exactRank}
                    icon={<Target size={16} />}
                  />
                  <MetricTile
                    label="Correct Results"
                    value={`${correctResultsTotal}`}
                    note={`${correctRate} overall result hit rate`}
                    rank={correctRank}
                    icon={<Crosshair size={16} />}
                  />
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                          Prediction Profile
                        </div>
                        <div className="mt-1 font-display text-xl font-semibold text-foreground">
                          Outcome accuracy by result type
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-white/62">
                        {displayStats.totalGradedPicks} graded
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {[
                        {
                          key: "H" as const,
                          label: "Home Win",
                          value: displayStats.outcomeHits.H,
                          total: displayStats.outcomeAttempts.H,
                        },
                        {
                          key: "D" as const,
                          label: "Draw",
                          value: displayStats.outcomeHits.D,
                          total: displayStats.outcomeAttempts.D,
                        },
                        {
                          key: "A" as const,
                          label: "Away Win",
                          value: displayStats.outcomeHits.A,
                          total: displayStats.outcomeAttempts.A,
                        },
                      ].map((row) => {
                        const ratio = row.total ? Math.max(0.08, row.value / row.total) : 0.08;
                        return (
                          <div key={row.key} className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-display text-sm font-semibold text-foreground">{row.label}</span>
                              <span className="font-display text-sm font-semibold text-white/75">
                                {row.value}/{row.total} ({pct(row.value, row.total)})
                              </span>
                            </div>
                            <div className="mt-3 h-2.5 rounded-full bg-white/[0.04]">
                              <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(245,158,11,0.58),rgba(56,189,248,0.58))]"
                                style={{ width: `${ratio * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>

                  <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
                    <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                      Recent Weeks
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">Latest scoring trend</div>
                    <div className="mt-4 space-y-2">
                      {recentGws.map((gw) => {
                        const value = stats?.byGw[gw] ?? 0;
                        const width = Math.min(100, Math.max(10, ((Math.abs(value) || 1) / Math.max(displayStats.bestGwPoints || 1, 1)) * 100));
                        return (
                          <div key={gw} className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-display text-sm font-semibold text-white/72">GW {gw}</span>
                              <span className="font-display text-base font-semibold text-foreground">{value}</span>
                            </div>
                            <div className="mt-3 h-2 rounded-full bg-white/[0.04]">
                              <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(56,189,248,0.55),rgba(245,158,11,0.55))]"
                                style={{ width: `${width}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                  <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                          Power & Risk
                        </div>
                        <div className="mt-1 font-display text-xl font-semibold text-foreground">
                          Chips, golden edge, and swing
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-white/62">
                        {displayStats.goldenPickCount} golden picks
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <MetricTile
                        label="Golden Bonus"
                        value={displayStats.goldenBonusPoints}
                        note="Extra points earned from doubled golden hits"
                        rank={goldenRank}
                        icon={<Sparkles size={16} />}
                      />
                      <MetricTile
                        label="Power-up Gain"
                        value={signedValue(displayStats.powerupPointsGained)}
                        note="Positive swing created by chips"
                        rank={gainRank}
                        icon={<ArrowUpRight size={16} />}
                      />
                      <MetricTile
                        label="Power-up Loss"
                        value={`-${displayStats.powerupPointsLost}`}
                        note="Opportunity cost from aggressive chip use"
                        rank={lossRank}
                        icon={<ArrowDownRight size={16} />}
                      />
                      <MetricTile
                        label="Goal Disparity"
                        value={signedValue(displayStats.goalDisparity)}
                        note="Difference between predicted and actual goals"
                        rank={disparityRank}
                        icon={<Swords size={16} />}
                      />
                    </div>
                  </SectionCard>

                  <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
                    <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                      Breakdown
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">Snapshot summary</div>
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-muted">Golden picks played</span>
                          <span className="font-display text-base font-semibold text-foreground">
                            {displayStats.goldenPickCount}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-muted">Power-up spread</span>
                          <span className="font-display text-base font-semibold text-foreground">
                            {displayStats.powerupUsage.ALL_IN} All-In • {displayStats.powerupUsage.SAFETY_NET} Safety Net
                          </span>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-muted">Exact vs result-only</span>
                          <span className="font-display text-base font-semibold text-foreground">
                            {displayStats.exactCount} / {displayStats.resultOnlyCount}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-muted">Best weekly output</span>
                          <span className="font-display text-base font-semibold text-foreground">
                            {displayStats.bestGw ? `GW${displayStats.bestGw} • ${displayStats.bestGwPoints}` : "No score yet"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                </div>
              </>
            )}
          </div>

          <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                  Editorial Notes
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-foreground">What this scope says</div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-white/70">
                <Shield size={16} />
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/48">
                  Accuracy Pulse
                </div>
                <div className="mt-2 text-sm text-muted">
                  {busy || !displayStats
                    ? "Loading current scoring profile."
                    : `${selectedPlayer?.displayName || "This player"} converts ${correctRate} of graded picks into correct outcomes, with ${exactRate} landing as exact scores.`}
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/48">
                  Risk Profile
                </div>
                <div className="mt-2 text-sm text-muted">
                  {busy || !displayStats
                    ? "Waiting for power-up data."
                    : displayStats.powerupPointsLost > displayStats.powerupPointsGained
                      ? "Aggressive chip use is costing more than it returns in this scope."
                      : "Chip usage is adding net value or staying disciplined."}
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/48">
                  Goal Forecasting
                </div>
                <div className="mt-2 text-sm text-muted">
                  {busy || !displayStats
                    ? "Waiting for scoring comparison."
                    : displayStats.goalDisparity === 0
                      ? "Predicted and actual goals are tracking almost perfectly."
                      : displayStats.goalDisparity > 0
                        ? "This player is generally forecasting more goals than actually arrive."
                        : "This player is generally undercalling total goals."}
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-xs text-muted">
                Last updated: {lastUpdated ? fmtDateTime(lastUpdated) : "No score run yet"}
              </div>
            </div>
          </SectionCard>
        </div>
      </SectionCard>
    </PageShell>
  );
}
