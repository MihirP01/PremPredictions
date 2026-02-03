"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
} from "firebase/firestore";

type Fixture = {
  fixtureId: number;
  gameweek: number;
  kickoff: string; // ISO
  status: string;
  home: { name: string };
  away: { name: string };
  result?: string | null; // "2-1" if finished
};

type Player = { uid: string; displayName: string };

// picksByFixture[fixtureId][uid] = "2-1"
type PicksByFixture = Record<number, Record<string, string>>;

// goldenByUid[uid] = { fixtureId, score }
type GoldenByUid = Record<string, { fixtureId: number; score: string }>;
type RoomPlayerDoc = { displayName?: string };
type PickDoc = { fixtureId?: number; uid?: string; score?: string };
type GoldenDoc = { fixtureId?: number; score?: string };
type FixturesResponse = { fixtures?: Fixture[]; generatedAt?: string };

const MIN_GW = 1;
const MAX_GW = 38;

function fmtKickoff(iso: string) {
  const dt = new Date(iso);

  const date = dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const time = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `${date} • ${time}`;
}


function fmtScore(s?: string | null) {
  if (!s) return "—";
  return String(s).replace("-", "–");
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
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

export default function FixturesPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picksByFixture, setPicksByFixture] = useState<PicksByFixture>({});
  const [goldenByUid, setGoldenByUid] = useState<GoldenByUid>({});
  const [error, setError] = useState<string | null>(null);
  const [gw, setGw] = useState<number>(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshingFixtures, setRefreshingFixtures] = useState(false);
  const [fixturesGeneratedAt, setFixturesGeneratedAt] = useState<Date | null>(
    null,
  );
  const [fixturesRefreshedAt, setFixturesRefreshedAt] = useState<Date | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/current-gameweek");
        const data = await res.json();
        const current = Number(data?.currentGameweek ?? 1);
        if (!cancelled) setGw(Number.isFinite(current) ? current : 1);
      } catch {
        if (!cancelled) setGw(1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  // Load room players (names)
  useEffect(() => {
    const q = query(collection(db, "rooms", roomCode, "players"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Player[] = snap.docs.map((d) => {
          const data = d.data() as RoomPlayerDoc;
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

  const loadFixtures = useCallback(
    async (opts?: { force?: boolean; showSpinner?: boolean }) => {
      const force = !!opts?.force;
      const showSpinner = opts?.showSpinner ?? true;

      if (showSpinner) setFixtures(null);
      setError(null);

      const nonce = force ? `&t=${Date.now()}` : "";
      const res = await fetch(`/api/fixtures?gameweek=${gw}${nonce}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`fixtures ${res.status}`);

      const data = (await res.json()) as FixturesResponse;
      const fx: Fixture[] = Array.isArray(data.fixtures) ? data.fixtures : [];
      setFixtures(fx);
      setFixturesGeneratedAt(asDate(data.generatedAt));
      setFixturesRefreshedAt(new Date());
    },
    [gw],
  );

  // Load fixtures for selected GW
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadFixtures({ showSpinner: true });
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "";
          setFixtures([]);
          setError(`Failed to load fixtures for GW ${gw}. ${message}`.trim());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gw, loadFixtures]);

  // Load minigame picks + golden for selected GW
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      setPicksByFixture({});
      setGoldenByUid({});

      const picksSnap = await getDocs(
        collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks"),
      );

      const byFx: PicksByFixture = {};
      for (const d of picksSnap.docs) {
        const data = d.data() as PickDoc;
        const fixtureId = Number(data.fixtureId);
        const uid = String(data.uid);
        const score = String(data.score);
        if (!byFx[fixtureId]) byFx[fixtureId] = {};
        byFx[fixtureId][uid] = score;
      }

      const goldenSnap = await getDocs(
        collection(db, "rooms", roomCode, "games", `gw-${gw}`, "golden"),
      );

      const gByUid: GoldenByUid = {};
      for (const d of goldenSnap.docs) {
        const data = d.data() as GoldenDoc;
        gByUid[d.id] = {
          fixtureId: Number(data.fixtureId),
          score: String(data.score),
        };
      }

      if (!cancelled) {
        setPicksByFixture(byFx);
        setGoldenByUid(gByUid);
      }
    })().catch((e) => {
      const msg = String(e?.message ?? "");
      if (!cancelled && msg.toLowerCase().includes("permission")) {
        setError(`Failed to load minigame picks: ${msg}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [roomCode, gw]);

  const gameweeks = useMemo(
    () => Array.from({ length: MAX_GW }, (_, i) => i + 1),
    [],
  );
  const isLoading = fixtures === null;

  async function refreshFixtures() {
    if (refreshingFixtures) return;
    setRefreshingFixtures(true);
    try {
      await loadFixtures({ force: true, showSpinner: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(`Failed to refresh fixtures for GW ${gw}. ${message}`.trim());
    } finally {
      setRefreshingFixtures(false);
    }
  }

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-3xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        {/* Header */}
        <div className="relative z-30 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              PL Fixtures
            </h1>
            <div className="text-sm text-muted">
              {roomCode} • GW {gw} Fixtures
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
                    onClick={refreshFixtures}
                    disabled={refreshingFixtures}
                    className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                  >
                    {refreshingFixtures ? "Refreshing..." : "Refresh Fixtures"}
                  </button>
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

        {/* GW nav */}
        <div className="flex items-center gap-3 w-full max-w-md mx-auto">
          <button
            disabled={isLoading || gw === MIN_GW}
            onClick={() => setGw((x) => Math.max(MIN_GW, x - 1))}
            className="
    h-10 w-10
    flex items-center justify-center
    rounded-lg
    bg-surface
    border border-teal-500
    text-foreground
    hover:bg-surface-2
    disabled:opacity-40
  "
          >
            ←
          </button>

          <div className="relative min-w-0 flex-1">
            <select
              value={gw}
              disabled={isLoading}
              onChange={(e) => setGw(Number(e.target.value))}
              className="
      w-full
      h-10
      px-8
      rounded-lg
      border border-teal-500
      bg-surface
      text-foreground
      text-sm font-semibold
      text-center
      appearance-none
      [text-align-last:center]
      focus:outline-none
      focus:ring-2
      focus:ring-teal-500
    "
            >
              {gameweeks.map((n) => (
                <option key={n} value={n}>
                  GW {n}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
              ▼
            </span>
          </div>

          <button
            disabled={isLoading || gw === MAX_GW}
            onClick={() => setGw((x) => Math.min(MAX_GW, x + 1))}
            className="
    h-10 w-10
    flex items-center justify-center
    rounded-lg
    bg-surface
    border border-teal-500
    text-foreground
    hover:bg-surface-2
    disabled:opacity-40
  "
          >
            →
          </button>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {/* Fixtures */}
        <div className="space-y-4">
          {isLoading && (
            <div className="text-center text-muted">Loading fixtures…</div>
          )}

          {!isLoading && fixtures.length === 0 && (
            <div className="text-center text-muted">
              No fixtures available for this gameweek.
            </div>
          )}

          {!isLoading &&
            fixtures.length > 0 &&
            fixtures.map((f, idx) => {
              const actual = f.result ?? null;

              return (
                <div
                  key={f.fixtureId}
                  className="border border-teal-500 rounded-xl p-4 bg-surface-2 page-action-btn"
                  style={{
                    animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                    animationDuration: "520ms",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-sm text-foreground">
                        {f.home.name} vs {f.away.name}
                      </div>
                      <div className="text-xs text-muted">
                        {fmtKickoff(f.kickoff)}
                      </div>
                      <div className="text-xs text-muted uppercase">
                        {f.status}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-muted">Result</div>
                      <div className="text-lm font-semibold text-foreground">
                        {actual ? actual.replace("-", " – ") : "TBD"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm font-semibold mb-2 text-foreground">
                      Room Predictions
                    </div>

                    {players.length === 0 ? (
                      <div className="text-sm text-muted">
                        No players found.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {players.map((p) => {
                          const pred =
                            picksByFixture?.[f.fixtureId]?.[p.uid] ?? "";
                          const golden = goldenByUid[p.uid];
                          const isGolden =
                            !!golden &&
                            golden.fixtureId === f.fixtureId &&
                            golden.score === pred;

                          return (
                            <div
                              key={p.uid}
                              className="flex items-center justify-between bg-surface border border-teal-500 rounded-lg px-3 py-2"
                            >
                              <div className="text-sm font-medium text-foreground truncate">
                                {p.displayName}
                              </div>

                              <div
                                className={[
                                  "inline-block rounded-lg px-2 py-1 border border-teal-500  whitespace-nowrap text-sm font-bold",
                                  isGolden
                                    ? "bg-yellow-300 text-black"
                                    : "bg-surface-2 text-foreground",
                                ].join(" ")}
                              >
                                {fmtScore(pred.replace("-", " - "))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {Object.keys(picksByFixture).length === 0 && (
                      <div className="text-xs text-muted mt-2">
                        No minigame picks saved for this GW yet.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {(fixturesGeneratedAt || fixturesRefreshedAt) && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-xs text-muted">
            {fixturesGeneratedAt && (
              <div>Fixture snapshot time: {fmtDateTime(fixturesGeneratedAt)}</div>
            )}
            {fixturesRefreshedAt && (
              <div>Fixtures page last refreshed: {fmtDateTime(fixturesRefreshedAt)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
