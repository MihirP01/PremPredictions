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
  const dateStr = dt.toLocaleDateString();
  const timeStr = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} • ${timeStr}`;
}

export default function FixturesPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picksByFixture, setPicksByFixture] = useState<PicksByFixture>({});
  const [goldenByUid, setGoldenByUid] = useState<GoldenByUid>({});
  const [error, setError] = useState<string | null>(null);
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
      (e) => setError(`Failed to load players: ${e?.message ?? "permission denied"}`)
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
        setError(`Failed to load fixtures for GW ${gw}. ${e?.message ?? ""}`.trim());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [gw]);

  // Load minigame picks + golden for selected GW (if none exist, we just show blanks)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      setPicksByFixture({});
      setGoldenByUid({});

      // picks
      const picksSnap = await getDocs(
        collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks")
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

      // golden
      const goldenSnap = await getDocs(
        collection(db, "rooms", roomCode, "games", `gw-${gw}`, "golden")
      );

      const gByUid: GoldenByUid = {};
      for (const d of goldenSnap.docs) {
        const data = d.data() as any;
        gByUid[d.id] = { fixtureId: Number(data.fixtureId), score: String(data.score) };
      }

      if (!cancelled) {
        setPicksByFixture(byFx);
        setGoldenByUid(gByUid);
      }
    })().catch((e) => {
      // Important: this should NOT hard-fail the page — many weeks won't have minigame data.
      // Only show an error if it's a real permission issue.
      const msg = String(e?.message ?? "");
      if (!cancelled && msg.toLowerCase().includes("permission")) {
        setError(`Failed to load minigame picks: ${msg}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [roomCode, gw]);

  const gameweeks = useMemo(() => Array.from({ length: MAX_GW }, (_, i) => i + 1), []);
  const isLoading = fixtures === null;

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Fixtures</h1>
            <div className="text-sm text-gray-500">Room {roomCode}</div>
          </div>

          <button
            onClick={() => router.push(`/room/${roomCode}`)}
            className="text-sm border rounded-lg px-4 py-2"
          >
            Back
          </button>
        </div>

        {/* GW nav (like before) */}
        <div className="flex items-center justify-center gap-3">
          <button
            className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50"
            disabled={isLoading || gw === MIN_GW}
            onClick={() => setGw((x) => Math.max(MIN_GW, x - 1))}
          >
            ←
          </button>

          <select
            className="px-3 py-2 rounded-lg border bg-white"
            value={gw}
            disabled={isLoading}
            onChange={(e) => setGw(Number(e.target.value))}
          >
            {gameweeks.map((n) => (
              <option key={n} value={n}>
                GW {n}
              </option>
            ))}
          </select>

          <button
            className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50"
            disabled={isLoading || gw === MAX_GW}
            onClick={() => setGw((x) => Math.min(MAX_GW, x + 1))}
          >
            →
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3">
            {error}
          </div>
        )}

        {/* Fixtures */}
        <div className="space-y-4">
          {isLoading && <div className="text-center text-gray-500">Loading fixtures…</div>}

          {!isLoading && fixtures.length === 0 && (
            <div className="text-center text-gray-500">No fixtures available for this gameweek.</div>
          )}

          {!isLoading &&
            fixtures.length > 0 &&
            fixtures.map((f) => {
              const actual = f.result ?? null;

              return (
                <div key={f.fixtureId} className="border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">
                        {f.home.name} vs {f.away.name}
                      </div>
                      <div className="text-xs text-gray-500">{fmtKickoff(f.kickoff)}</div>
                      <div className="text-xs text-gray-500 uppercase">{f.status}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-gray-600">Result</div>
                      <div className="text-lg font-semibold">
                        {actual ? actual.replace("-", " – ") : "TBD"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm font-semibold mb-2">Room Predictions</div>

                    {players.length === 0 ? (
                      <div className="text-sm text-gray-500">No players found.</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {players.map((p) => {
                          const pred = picksByFixture?.[f.fixtureId]?.[p.uid] ?? "";
                          const golden = goldenByUid[p.uid];
                          const isGolden =
                            !!golden &&
                            golden.fixtureId === f.fixtureId &&
                            golden.score === pred;

                          return (
                            <div
                              key={p.uid}
                              className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                            >
                              <div className="text-sm font-medium">{p.displayName}</div>
                              <div className="flex items-center gap-2">
                                {isGolden && (
                                  <span className="text-xs bg-yellow-100 rounded-full px-2 py-1">
                                    Golden
                                  </span>
                                )}
                                <div className="text-sm text-gray-700">
                                  {pred ? pred.replace("-", " – ") : "—"}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {Object.keys(picksByFixture).length === 0 && (
                      <div className="text-xs text-gray-500 mt-2">
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