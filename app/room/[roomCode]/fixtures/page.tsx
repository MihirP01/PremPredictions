"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import {
  collection,
  doc,
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
          const data = d.data() as any;
          return { uid: d.id, displayName: data?.displayName || "Player" };
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

  // Load fixtures for selected GW
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      setFixtures(null);

      const res = await fetch(`/api/fixtures?gameweek=${gw}`);
      if (!res.ok) throw new Error(`fixtures ${res.status}`);

      const data = await res.json();
      const fx: Fixture[] = Array.isArray(data?.fixtures) ? data.fixtures : [];

      if (!cancelled) setFixtures(fx);
    })().catch((e) => {
      if (!cancelled) {
        setFixtures([]);
        setError(
          `Failed to load fixtures for GW ${gw}. ${e?.message ?? ""}`.trim(),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [gw]);

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
        const data = d.data() as any;
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
        const data = d.data() as any;
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

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-3xl mx-auto bg-surface rounded-2xl shadow-card p-6 space-y-4 border border-subtle">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              PL Fixtures
            </h1>
            <div className="text-sm text-muted">
              {roomCode} • GW {gw} Fixtures
            </div>
          </div>

          <button
            onClick={() => router.push(`/room/${roomCode}`)}
            className="text-sm rounded-lg px-4 py-2 bg-surface border border-subtle text-foreground hover:bg-surface-2"
          >
            Back
          </button>
        </div>

        {/* GW nav */}
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={isLoading || gw === MIN_GW}
            onClick={() => setGw((x) => Math.max(MIN_GW, x - 1))}
            className="
    h-10 w-10
    flex items-center justify-center
    rounded-lg
    bg-surface
    border border-subtle
    text-foreground
    hover:bg-surface-2
    disabled:opacity-40
  "
          >
            ←
          </button>

          <div className="relative">
            <select
              value={gw}
              disabled={isLoading}
              onChange={(e) => setGw(Number(e.target.value))}
              className="
      h-10
      px-6
      rounded-lg
      border border-teal-500
      bg-surface
      text-foreground
      text-sm font-medium
      text-center
      appearance-none
      flex items-center justify-center
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
          </div>

          <button
            disabled={isLoading || gw === MAX_GW}
            onClick={() => setGw((x) => Math.min(MAX_GW, x + 1))}
            className="
    h-10 w-10
    flex items-center justify-center
    rounded-lg
    bg-surface
    border border-subtle
    text-foreground
    hover:bg-surface-2
    disabled:opacity-40
  "
          >
            →
          </button>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-subtle text-danger">
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
            fixtures.map((f) => {
              const actual = f.result ?? null;

              return (
                <div
                  key={f.fixtureId}
                  className="border border-subtle rounded-xl p-4 bg-surface-2"
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
                              className="flex items-center justify-between bg-surface border border-subtle rounded-lg px-3 py-2"
                            >
                              <div className="text-sm font-medium text-foreground truncate">
                                {p.displayName}
                              </div>

                              <div
                                className={[
                                  "inline-block rounded-lg px-2 py-1 border border-subtle  whitespace-nowrap text-sm font-bold",
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
      </div>
    </div>
  );
}
