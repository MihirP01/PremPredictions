"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { collection, doc, getDoc, getDocs, onSnapshot, query } from "firebase/firestore";

type Player = { uid: string; displayName: string };
type ScoreDoc = {
  points?: number;
  breakdown?: Record<
    string,
    {
      base?: number;
      golden?: boolean;
      pred?: string | null;
      actual?: string | null;
      total?: number;
    }
  >;
};
type ScoreWeekSummary = { computedAt?: unknown };
type RoomPlayerDoc = { displayName?: string; nickName?: string };
function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

type PlayerStats = {
  totalPoints: number;
  weeksScored: number;
  exactCount: number;
  resultOnlyCount: number;
  totalGradedPicks: number;
  goldenBonusPoints: number;
  goldenPickCount: number;
  outcomeAttempts: { H: number; D: number; A: number };
  outcomeHits: { H: number; D: number; A: number };
  bestGw: number | null;
  bestGwPoints: number;
  byGw: Record<number, number>;
};

function parseGwId(id: string): number | null {
  const m = /^gw-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const ts = value as { toDate?: () => Date };
    if (typeof ts.toDate === "function") {
      const d = ts.toDate();
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

export default function RoomStatsPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>("");
  const [currentGw, setCurrentGw] = useState<number>(1);
  const [seasonKey, setSeasonKey] = useState<string>("");
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsByUid, setStatsByUid] = useState<Record<string, PlayerStats>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const roomSnap = await getDoc(doc(db, "rooms", roomCode));
        if (!roomSnap.exists()) {
          router.replace("/room-gate");
          return;
        }
        const memberSnap = user
          ? await getDoc(doc(db, "rooms", roomCode, "players", user.uid))
          : null;
        if (user && memberSnap && !memberSnap.exists()) {
          router.replace("/room-gate");
          return;
        }
      } catch {
        if (!cancelled) setError("Failed to verify room access.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode, router, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCurrentGameweekCached();
        const n = Number(data.currentGameweek ?? 1);
        if (!cancelled) {
          setCurrentGw(Number.isFinite(n) ? n : 1);
          setSeasonKey(String(data.seasonKey || ""));
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, "rooms", roomCode, "seasons"),
        );
        const keys = snap.docs
          .map((d) => d.id)
          .filter((id) => /^\d{4}$/.test(id))
          .sort((a, b) => b.localeCompare(a));
        if (seasonKey && !keys.includes(seasonKey)) keys.unshift(seasonKey);
        if (!cancelled) setSeasonOptions(keys);
      } catch {
        if (!cancelled && seasonKey) setSeasonOptions([seasonKey]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode, seasonKey]);

  useEffect(() => {
    if (!seasonKey) return;
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
    const q = query(collection(db, "rooms", roomCode, "players"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const data = d.data() as RoomPlayerDoc;
            const nick = String(data.nickName || "").trim();
            return {
              uid: d.id,
              displayName: nick || data.displayName || "Player",
            } satisfies Player;
          })
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPlayers(list);
      },
      () => setError("Failed to load room players."),
    );
    return () => unsub();
  }, [roomCode]);

  const effectiveSelectedUid = useMemo(() => {
    if (selectedUid && players.some((p) => p.uid === selectedUid)) return selectedUid;
    if (user && players.some((p) => p.uid === user.uid)) return user.uid;
    return players[0]?.uid ?? "";
  }, [players, selectedUid, user]);

  useEffect(() => {
    if (players.length === 0 || !seasonKey) return;

    const playerSet = new Set(players.map((p) => p.uid));
    const baseStats: Record<string, PlayerStats> = {};
    for (const p of players) {
      baseStats[p.uid] = {
        totalPoints: 0,
        weeksScored: 0,
        exactCount: 0,
        resultOnlyCount: 0,
        totalGradedPicks: 0,
        goldenBonusPoints: 0,
        goldenPickCount: 0,
        outcomeAttempts: { H: 0, D: 0, A: 0 },
        outcomeHits: { H: 0, D: 0, A: 0 },
        bestGw: null,
        bestGwPoints: 0,
        byGw: {},
      };
    }

    let cancelled = false;

    (async () => {
      if (!cancelled) {
        setBusy(true);
        setError(null);
      }
      let latestComputedAt: Date | null = null;
      const scoreWeeksSnap = await getDocs(
        collection(db, "rooms", roomCode, "seasons", seasonKey, "scores"),
      );
      const gws = scoreWeeksSnap.docs
        .map((d) => parseGwId(d.id))
        .filter((n): n is number => n !== null && n >= 1 && n <= currentGw)
        .sort((a, b) => a - b);

      for (const weekDoc of scoreWeeksSnap.docs) {
        const summary = weekDoc.data() as ScoreWeekSummary;
        const computedAt = asDate(summary.computedAt);
        if (computedAt && (!latestComputedAt || computedAt > latestComputedAt)) {
          latestComputedAt = computedAt;
        }
      }

      for (const gw of gws) {
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

        for (const userScoreDoc of usersSnap.docs) {
          const uid = userScoreDoc.id;
          if (!playerSet.has(uid)) continue;

          const score = userScoreDoc.data() as ScoreDoc;
          const points = Number(score.points ?? 0);
          const s = baseStats[uid];
          if (!s) continue;

          s.totalPoints += Number.isFinite(points) ? points : 0;
          s.weeksScored += 1;
          s.byGw[gw] = Number.isFinite(points) ? points : 0;

          if (s.bestGw == null || points > s.bestGwPoints) {
            s.bestGw = gw;
            s.bestGwPoints = points;
          }

          const breakdown = score.breakdown ?? {};
          for (const item of Object.values(breakdown)) {
            if (item.pred != null && String(item.pred).trim() !== "") {
              s.totalGradedPicks += 1;
            }
            if (item.base === 2) s.exactCount += 1;
            else if (item.base === 1) s.resultOnlyCount += 1;
            if (item.golden) {
              s.goldenPickCount += 1;
              const base = Number(item.base ?? 0);
              if (Number.isFinite(base) && base > 0) {
                // Golden doubles fixture points; bonus = added copy of base points.
                s.goldenBonusPoints += base;
              }
            }

            const predOutcome = item.pred ? outcome(item.pred) : null;
            const actualOutcome = item.actual ? outcome(String(item.actual)) : null;
            if (predOutcome && actualOutcome) {
              s.outcomeAttempts[predOutcome] += 1;
              if (predOutcome === actualOutcome) {
                s.outcomeHits[predOutcome] += 1;
              }
            }
          }
        }
      }

      if (!cancelled) {
        setStatsByUid(baseStats);
        setLastUpdated(latestComputedAt);
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
  }, [players, roomCode, currentGw, seasonKey]);

  if (loading || !user) return null;

  const selectedPlayer = players.find((p) => p.uid === effectiveSelectedUid) ?? null;
  const stats = effectiveSelectedUid ? statsByUid[effectiveSelectedUid] : null;
  const recentGws = Array.from({ length: Math.min(5, currentGw) }, (_, i) => currentGw - i);

  return (
    <div className="min-h-[100dvh] p-6 bg-app">
      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Player Stats</h1>
              <div className="font-display text-sm text-muted">
                {roomCode} • {seasonLabel(seasonKey || "----")} • GW 1 - GW {currentGw}
              </div>
            </div>
            <button
              onClick={() => router.push(`/room/${roomCode}`)}
              className="h-10 text-sm rounded-lg px-4 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
            >
              Back
            </button>
          </div>
          {!!seasonOptions.length && (
            <div className="w-[132px] sm:w-[140px] relative">
              <label className="sr-only" htmlFor="stats-season-select">
                Select season
              </label>
              <select
                id="stats-season-select"
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
        </div>

        <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 space-y-3">
          <label className="text-sm text-muted block">Select player</label>
          <div className="relative">
            <select
              value={effectiveSelectedUid}
              onChange={(e) => setSelectedUid(e.target.value)}
              className="font-display w-full h-10 rounded-lg border border-teal-500 bg-surface text-foreground text-sm font-semibold px-8 text-center appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {players.map((p) => (
                <option className="font-display" key={p.uid} value={p.uid}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
              ▼
            </span>
          </div>
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        {busy ? (
          <div className="text-sm text-muted">Loading stats…</div>
        ) : !selectedPlayer || !stats ? (
          <div className="text-sm text-muted">No player stats available yet.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
                <div className="text-xs text-muted">Total Points</div>
                <div className="font-display text-xl font-semibold text-foreground">{stats.totalPoints}</div>
              </div>
              <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
                <div className="text-xs text-muted">Weeks Scored</div>
                <div className="font-display text-xl font-semibold text-foreground">{stats.weeksScored}</div>
              </div>
              <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
                <div className="text-xs text-muted">Exact Scores</div>
                <div className="font-display text-xl font-semibold text-foreground">
                  {stats.exactCount} ({pct(stats.exactCount, stats.totalGradedPicks)})
                </div>
              </div>
              <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
                <div className="text-xs text-muted">Correct Results</div>
                <div className="font-display text-xl font-semibold text-foreground">
                  {stats.resultOnlyCount} ({pct(stats.resultOnlyCount, stats.totalGradedPicks)})
                </div>
              </div>
              <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
                <div className="text-xs text-muted">Golden Bonus Points</div>
                <div className="font-display text-xl font-semibold text-foreground">
                  {stats.goldenBonusPoints}
                </div>
              </div>
              <div className="border border-teal-500 rounded-xl p-3 bg-surface-2">
                <div className="text-xs text-muted">Best GW</div>
                <div className="font-display text-xl font-semibold text-foreground">
                  {stats.bestGw ? `GW${stats.bestGw} (${stats.bestGwPoints})` : "-"}
                </div>
              </div>
            </div>

            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
              <div className="font-semibold text-foreground mb-2">Recent Weeks</div>
              <div className="space-y-2">
                {recentGws.map((gw) => (
                  <div
                    key={gw}
                    className="flex items-center justify-between border-b border-subtle last:border-0 py-1"
                  >
                    <span className="font-display text-sm text-muted">GW {gw}</span>
                    <span className="font-display font-semibold text-foreground">{stats.byGw[gw] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
              <div className="font-semibold text-foreground mb-2">Hit Rate by Type</div>
              <div className="space-y-2">
                {[
                  { key: "H" as const, label: "Home Win" },
                  { key: "D" as const, label: "Draw" },
                  { key: "A" as const, label: "Away Win" },
                ].map((t) => (
                  <div
                    key={t.key}
                    className="flex items-center justify-between border-b border-subtle last:border-0 py-1"
                  >
                    <span className="text-sm text-muted">{t.label}</span>
                    <span className="font-display font-semibold text-foreground">
                      {stats.outcomeHits[t.key]}/{stats.outcomeAttempts[t.key]} (
                      {pct(stats.outcomeHits[t.key], stats.outcomeAttempts[t.key])})
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </>
        )}

        <div className="text-xs text-muted">
          Last updated: {lastUpdated ? fmtDateTime(lastUpdated) : "No score run yet"}
        </div>
      </div>
    </div>
  );
}
