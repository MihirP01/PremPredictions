"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
} from "firebase/firestore";

type Player = { uid: string; displayName: string };
type RoomPlayerDoc = { displayName?: string; nickName?: string };

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
  const [latestScoredGw, setLatestScoredGw] = useState<number | null>(null);
  const [selectedTableGw, setSelectedTableGw] = useState<number>(1);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);

  // matrix: userUid -> gw -> points (read only from score docs)
  const [pointsByUserByGw, setPointsByUserByGw] = useState<
    Record<string, Record<number, number>>
  >({});

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  // load default season + gameweek
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

  // keep season options from room data (historical seasons)
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

  // whenever selected season changes, refresh season-specific current GW
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
    setSelectedTableGw(currentGw);
  }, [currentGw]);

  // live players list
  useEffect(() => {
    const q = query(collection(db, "rooms", roomCode, "players"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Player[] = snap.docs.map((d) => {
          const data = d.data() as RoomPlayerDoc;
          const nick = String(data.nickName || "").trim();
          return { uid: d.id, displayName: nick || data.displayName || "Player" };
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

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (settingsWrapRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [settingsOpen]);

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
    if (players.length === 0 || !seasonKey) return;

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
  }, [players, currentGw, roomCode, seasonKey]);

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
      byGw[gw] = {};
      ranked.forEach((p, idx) => {
        byGw[gw][p.uid] = idx + 1;
      });
    }
    return byGw;
  }, [weeks, players, pointsByUserByGw, totalByUser]);

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

  return (
    <div className="min-h-[100dvh] p-6 bg-app">
      <div className="max-w-6xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="relative z-30 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Leaderboard</h1>
              <div className="text-sm text-muted">
                {roomCode} • {seasonLabel(seasonKey || "----")} • GW1 - GW{currentGw}
              </div>
            </div>
            <div className="ml-auto flex gap-2 page-actions-enter">
              <button
                onClick={() => router.push(`/room/${roomCode}`)}
                className="h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 whitespace-nowrap inline-flex items-center justify-center page-action-btn"
                data-action="back"
              >
                Back
              </button>
            </div>
          </div>

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
            <div ref={settingsWrapRef} className="relative ml-auto page-actions-enter">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex items-center justify-center page-action-btn"
                data-action="settings"
                aria-label="Open settings"
              >
                <Settings size={16} />
              </button>
              {settingsOpen && (
                <div className="absolute top-0 right-[calc(100%+12px)] w-60 sm:w-72 rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-2 shadow-card z-20 settings-panel-enter">
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
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn md:col-span-3"
            style={{ animationDelay: "120ms", animationDuration: "520ms" }}
          >
            <div className="text-sm font-semibold text-foreground text-center">Overall Top 3</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {sortedPlayers.slice(0, 3).map((p, i) => {
                const rank = i + 1;
                return (
                  <div
                    key={`overall-${p.uid}`}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${rankStyle(rank)}`}
                  >
                    {rankLabel(rank)} {p.displayName} - {totalByUser[p.uid] ?? 0}
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn md:hidden"
            style={{ animationDelay: "230ms", animationDuration: "520ms" }}
          >
            <div className="text-sm font-semibold text-foreground text-center">Current GW{currentGw} Top 3</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {currentGwSortedPlayers.slice(0, 3).map((p, i) => {
                const rank = i + 1;
                const points = pointsByUserByGw?.[p.uid]?.[currentGw] ?? 0;
                return (
                  <div
                    key={`gw-${p.uid}`}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${rankStyle(rank)}`}
                  >
                    {rankLabel(rank)} {p.displayName} - {points}
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="rounded-xl p-3 bg-surface-2 border border-teal-500 page-action-btn md:hidden"
            style={{ animationDelay: "340ms", animationDuration: "520ms" }}
          >
            <div className="text-sm font-semibold text-foreground text-center">Previous GW{medalsGw} Top 3</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {previousGwSortedPlayers.slice(0, 3).map((p, i) => {
                const rank = i + 1;
                const points = pointsByUserByGw?.[p.uid]?.[medalsGw] ?? 0;
                return (
                  <div
                    key={`prev-gw-${p.uid}`}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${rankStyle(rank)}`}
                  >
                    {rankLabel(rank)} {p.displayName} - {points}
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
              const rankToHighlight = pts > 0 ? i + 1 : 0;
              return (
                <div
                  key={`mobile-gw-${selectedTableGw}-${p.uid}`}
                  className={[
                    "flex items-center justify-between rounded-lg border px-3 py-2",
                    rankToHighlight === 1
                      ? "border-yellow-400/80 bg-yellow-400/15"
                      : rankToHighlight === 2
                        ? "border-gray-300/80 bg-gray-300/15"
                        : rankToHighlight === 3
                        ? "border-amber-500/80 bg-amber-500/15"
                        : "border-teal-500 bg-surface",
                  ].join(" ")}
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
                    GW{gw}
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
                          "inline-flex min-w-[44px] justify-center whitespace-nowrap rounded-md px-1.5 py-0.5",
                          rankToHighlight === 1
                            ? "bg-yellow-400/20 border border-yellow-400/80"
                            : rankToHighlight === 2
                              ? "bg-gray-300/20 border border-gray-300/80"
                              : rankToHighlight === 3
                                ? "bg-amber-500/20 border border-amber-500/80"
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
