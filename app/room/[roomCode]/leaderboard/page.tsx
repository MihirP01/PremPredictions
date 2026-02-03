"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
} from "firebase/firestore";

type Player = { uid: string; displayName: string };

type ScoreDoc = {
  uid?: string;
  points?: number;
};

type RoomDoc = {
  leaderUid?: string;
};

type ScoreWeekSummaryDoc = {
  computedAt?: unknown;
};

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

function rankStyle(rank: number) {
  if (rank === 1) return "bg-yellow-300 text-black";
  if (rank === 2) return "bg-gray-300 text-black";
  return "bg-amber-600 text-white";
}

function rankLabel(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  return "🥉";
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
  const [busy, setBusy] = useState(false);
  const [leaderToolBusy, setLeaderToolBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gwScoreComputedAt, setGwScoreComputedAt] = useState<Date | null>(null);
  const [leaderboardRefreshedAt, setLeaderboardRefreshedAt] =
    useState<Date | null>(null);
  const [latestScoredGw, setLatestScoredGw] = useState<number | null>(null);
  const [selectedTableGw, setSelectedTableGw] = useState<number>(1);

  // matrix: userUid -> gw -> points (read only from score docs)
  const [pointsByUserByGw, setPointsByUserByGw] = useState<
    Record<string, Record<number, number>>
  >({});

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  // load current gameweek
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/current-gameweek");
        const data = await res.json();
        const n = Number(data?.currentGameweek ?? 1);
        if (!cancelled) setCurrentGw(Number.isFinite(n) ? n : 1);
      } catch {
        if (!cancelled) setCurrentGw(1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedTableGw(currentGw);
  }, [currentGw]);

  // live players list
  useEffect(() => {
    const q = query(collection(db, "rooms", roomCode, "players"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Player[] = snap.docs.map((d) => {
          const data = d.data() as { displayName?: string };
          return { uid: d.id, displayName: data.displayName || "Player" };
        });
        setPlayers(list);
      },
      (e) =>
        setError(
          `Failed to load players: ${e?.message ?? "permission denied"}`,
        ),
    );
    return () => unsub();
  }, [roomCode]);

  // room leader (for leader-only tools)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "rooms", roomCode));
        const data = snap.data() as RoomDoc | undefined;
        if (!cancelled) setLeaderUid(data?.leaderUid ?? null);
      } catch {
        if (!cancelled) setLeaderUid(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  const loadSavedScores = useCallback(async () => {
    if (players.length === 0) return;

    setBusy(true);
    setError(null);

    const matrix: Record<string, Record<number, number>> = {};
    for (const p of players) {
      matrix[p.uid] = {};
      for (let gw = 1; gw <= currentGw; gw++) matrix[p.uid][gw] = 0;
    }

    try {
      // Only read already-computed score docs, never recompute in leaderboard.
      const scoreWeeksSnap = await getDocs(
        collection(db, "rooms", roomCode, "scores"),
      );
      let currentGwComputedAt: Date | null = null;
      for (const scoreWeekDoc of scoreWeeksSnap.docs) {
        if (scoreWeekDoc.id !== `gw-${currentGw}`) continue;
        const summary = scoreWeekDoc.data() as ScoreWeekSummaryDoc;
        currentGwComputedAt = asDate(summary.computedAt);
      }

      let computedGws = scoreWeeksSnap.docs
        .map((d) => parseGwId(d.id))
        .filter((n): n is number => n !== null && n >= 1 && n <= currentGw);

      // Backward compatibility: if older score runs wrote only /users docs
      // without gw summary docs, derive the candidate weeks from /games.
      if (computedGws.length === 0) {
        const gameWeeksSnap = await getDocs(
          collection(db, "rooms", roomCode, "games"),
        );
        computedGws = gameWeeksSnap.docs
          .map((d) => parseGwId(d.id))
          .filter((n): n is number => n !== null && n >= 1 && n <= currentGw);
      }

      computedGws = Array.from(new Set(computedGws)).sort((a, b) => a - b);

      for (const gw of computedGws) {
        const usersSnap = await getDocs(
          collection(db, "rooms", roomCode, "scores", `gw-${gw}`, "users"),
        );

        for (const d of usersSnap.docs) {
          const data = d.data() as ScoreDoc;
          const uid = String(data.uid ?? d.id);
          const points = Number(data.points ?? 0);

          if (!Number.isFinite(points)) continue;
          if (!matrix[uid]) continue; // only show current room players

          matrix[uid][gw] = points;
        }
      }

      setPointsByUserByGw(matrix);
      setGwScoreComputedAt(currentGwComputedAt);
      setLeaderboardRefreshedAt(new Date());
      setLatestScoredGw(computedGws.length ? computedGws[computedGws.length - 1] : null);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load saved scores."));
    } finally {
      setBusy(false);
    }
  }, [players, currentGw, roomCode]);

  useEffect(() => {
    loadSavedScores().catch(() => {});
  }, [loadSavedScores]);

  const weeks = useMemo(
    () => Array.from({ length: currentGw }, (_, i) => currentGw - i),
    [currentGw],
  );

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
    list.sort((a, b) => (totalByUser[b.uid] ?? 0) - (totalByUser[a.uid] ?? 0));
    return list;
  }, [players, totalByUser]);

  const medalsGw = latestScoredGw ?? currentGw;

  const previousGwSortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort(
      (a, b) =>
        (pointsByUserByGw?.[b.uid]?.[medalsGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[medalsGw] ?? 0),
    );
    return list;
  }, [players, pointsByUserByGw, medalsGw]);

  const currentGwSortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort(
      (a, b) =>
        (pointsByUserByGw?.[b.uid]?.[currentGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[currentGw] ?? 0),
    );
    return list;
  }, [players, pointsByUserByGw, currentGw]);

  const isLeader = !!user && leaderUid === user.uid;
  const mobileGwSortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      const byGw =
        (pointsByUserByGw?.[b.uid]?.[selectedTableGw] ?? 0) -
        (pointsByUserByGw?.[a.uid]?.[selectedTableGw] ?? 0);
      if (byGw !== 0) return byGw;
      return (totalByUser[b.uid] ?? 0) - (totalByUser[a.uid] ?? 0);
    });
    return list;
  }, [players, pointsByUserByGw, selectedTableGw, totalByUser]);

  async function recalcAndRefreshScores() {
    if (!user || !isLeader) return;
    if (leaderToolBusy) return;

    setLeaderToolBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, gw: currentGw, leaderUid: user.uid }),
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

  return (
    <div className="min-h-[100dvh] p-6 bg-app">
      <div className="max-w-6xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="relative z-30 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Leaderboard
            </h1>
            <div className="text-sm text-muted">
              {roomCode} • GW1 - GW{currentGw}
            </div>
            <div className="text-xs text-muted mt-1">
              Shows saved score docs only. Recalculate from room tools first.
            </div>
          </div>

          <div className="self-end flex gap-2 page-actions-enter">
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex items-center justify-center page-action-btn"
                data-action="settings"
                aria-label="Open settings"
              >
                <Settings size={16} />
              </button>
              {settingsOpen && (
                <div className="absolute right-0 mt-2 w-60 sm:w-72 rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-2 shadow-card z-20 settings-panel-enter">
                  <div className="font-semibold text-foreground">Settings</div>
                  <button
                    onClick={() => loadSavedScores()}
                    disabled={busy}
                    className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                  >
                    {busy ? "Refreshing..." : "Refresh Leaderboard"}
                  </button>
                  {isLeader && (
                    <div className="rounded-lg border border-teal-500 p-3 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                        Leader Tools
                      </div>
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
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => router.push(`/room/${roomCode}`)}
              className="h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 whitespace-nowrap inline-flex items-center justify-center page-action-btn"
              data-action="back"
            >
              Back
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn"
            style={{ animationDelay: "120ms", animationDuration: "520ms" }}
          >
            <div className="text-sm font-semibold text-foreground">Overall Top 3</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {sortedPlayers.slice(0, 3).map((p, i) => {
                const rank = i + 1;
                return (
                  <div
                    key={`overall-${p.uid}`}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${rankStyle(rank)}`}
                  >
                    {rankLabel(rank)} • {p.displayName} ({totalByUser[p.uid] ?? 0})
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn"
            style={{ animationDelay: "230ms", animationDuration: "520ms" }}
          >
            <div className="text-sm font-semibold text-foreground">Current GW{currentGw} Top 3</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {currentGwSortedPlayers.slice(0, 3).map((p, i) => {
                const rank = i + 1;
                const points = pointsByUserByGw?.[p.uid]?.[currentGw] ?? 0;
                return (
                  <div
                    key={`gw-${p.uid}`}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${rankStyle(rank)}`}
                  >
                    {rankLabel(rank)} • {p.displayName} ({points})
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn"
            style={{ animationDelay: "340ms", animationDuration: "520ms" }}
          >
            <div className="text-sm font-semibold text-foreground">Previous GW{medalsGw} Top 3</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {previousGwSortedPlayers.slice(0, 3).map((p, i) => {
                const rank = i + 1;
                const points = pointsByUserByGw?.[p.uid]?.[medalsGw] ?? 0;
                return (
                  <div
                    key={`prev-gw-${p.uid}`}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${rankStyle(rank)}`}
                  >
                    {rankLabel(rank)} • {p.displayName} ({points})
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="md:hidden rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn"
          style={{ animationDelay: "460ms", animationDuration: "520ms" }}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setSelectedTableGw((g) => Math.max(1, g - 1))}
              disabled={selectedTableGw <= 1}
              className="h-9 w-9 rounded-lg border border-teal-500 bg-surface text-foreground disabled:opacity-40"
            >
              ←
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
                {Array.from({ length: currentGw }, (_, i) => currentGw - i).map(
                  (gw) => (
                    <option key={gw} value={gw}>
                      GW{gw} Scores
                    </option>
                  ),
                )}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                ▼
              </span>
            </div>
            <button
              onClick={() =>
                setSelectedTableGw((g) => Math.min(currentGw, g + 1))
              }
              disabled={selectedTableGw >= currentGw}
              className="h-9 w-9 rounded-lg border border-teal-500 bg-surface text-foreground disabled:opacity-40"
            >
              →
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {mobileGwSortedPlayers.map((p, i) => {
              const pts = pointsByUserByGw?.[p.uid]?.[selectedTableGw] ?? 0;
              return (
                <div
                  key={`mobile-gw-${selectedTableGw}-${p.uid}`}
                  className="flex items-center justify-between rounded-lg border border-teal-500 bg-surface px-3 py-2"
                >
                  <div className="text-sm text-foreground">
                    {i < 3 ? `${rankLabel(i + 1)} ` : ""}
                    {p.displayName}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{pts}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="hidden md:block overflow-x-auto border border-teal-500 rounded-xl bg-surface-2 page-action-btn"
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
                    <span className="block truncate">{p.displayName}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {weeks.map((gw) => (
                <tr key={gw} className="border-b border-subtle last:border-0">
                  <td className="w-[120px] p-3 font-semibold text-foreground sticky left-0 bg-surface-2 z-10">
                    GW{gw}
                  </td>
                  {sortedPlayers.map((p) => (
                    <td key={p.uid} className="p-3 text-center text-foreground">
                      <span className="inline-flex min-w-[44px] justify-center whitespace-nowrap">
                        {pointsByUserByGw?.[p.uid]?.[gw] ?? 0}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}

            </tbody>
          </table>
        </div>

        {(gwScoreComputedAt || leaderboardRefreshedAt) && (
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-xs text-muted page-action-btn"
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
      </div>
    </div>
  );
}
