"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
} from "firebase/firestore";

type Player = { uid: string; displayName: string };

type Fixture = {
  fixtureId: number;
  status: string;
  result?: string | null; // "2-1" if finished
};

type PicksByFixture = Record<number, Record<string, string>>; // fixtureId -> uid -> "2-1"
type GoldenByUid = Record<string, { fixtureId: number; score: string }>;

function outcome(h: number, a: number) {
  if (h > a) return "H";
  if (h < a) return "A";
  return "D";
}

function parseScore(s?: string | null) {
  if (!s) return null;
  const m = /^(\d+)-(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

function calculatePoints(predScore: string | null, actualScore: string | null, isGolden: boolean) {
  const p = parseScore(predScore);
  const a = parseScore(actualScore);
  if (!p || !a) return 0;

  let base = 0;
  if (p.home === a.home && p.away === a.away) base = 2;
  else if (outcome(p.home, p.away) === outcome(a.home, a.away)) base = 1;

  return isGolden ? base * 2 : base; // 0/2/4 golden, 0/1/2 normal
}

function parseGwId(id: string): number | null {
  const m = /^gw-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export default function LeaderboardMatrixPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [players, setPlayers] = useState<Player[]>([]);
  const [currentGw, setCurrentGw] = useState<number>(1);
  const [playedGws, setPlayedGws] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // matrix: userUid -> gw -> points
  const [pointsByUserByGw, setPointsByUserByGw] = useState<Record<string, Record<number, number>>>({});

  // cache fixtures per GW to avoid extra API calls
  const fixturesCacheRef = useRef<Record<number, Fixture[]>>({});

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

  // live players list
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

  // load which GWs have minigame docs (played)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "rooms", roomCode, "games"));
        const gws = snap.docs
          .map((d) => parseGwId(d.id))
          .filter((n): n is number => n !== null)
          .sort((a, b) => a - b);

        if (!cancelled) setPlayedGws(gws);
      } catch (e: any) {
        if (!cancelled) setError(`Failed to load played weeks: ${e?.message ?? "permission denied"}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  async function getFixturesForGw(gw: number): Promise<Fixture[]> {
    if (fixturesCacheRef.current[gw]) return fixturesCacheRef.current[gw];

    const res = await fetch(`/api/fixtures?gameweek=${gw}`);
    if (!res.ok) throw new Error(`fixtures fetch failed (GW ${gw}, status ${res.status})`);
    const data = await res.json();
    const fx: Fixture[] = Array.isArray(data?.fixtures) ? data.fixtures : [];
    fixturesCacheRef.current[gw] = fx;
    return fx;
  }

  async function getPicksForGw(gw: number): Promise<PicksByFixture> {
    const snap = await getDocs(collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks"));

    const byFx: PicksByFixture = {};
    for (const d of snap.docs) {
      const data = d.data() as any;
      const fixtureId = Number(data.fixtureId);
      const uid = String(data.uid);
      const score = String(data.score);
      if (!byFx[fixtureId]) byFx[fixtureId] = {};
      byFx[fixtureId][uid] = score;
    }
    return byFx;
  }

  async function getGoldenForGw(gw: number): Promise<GoldenByUid> {
    const snap = await getDocs(collection(db, "rooms", roomCode, "games", `gw-${gw}`, "golden"));

    const g: GoldenByUid = {};
    for (const d of snap.docs) {
      const data = d.data() as any;
      g[d.id] = { fixtureId: Number(data.fixtureId), score: String(data.score) };
    }
    return g;
  }

  function computeGwTotals(fx: Fixture[], picks: PicksByFixture, golden: GoldenByUid) {
    const totals: Record<string, number> = {};
    for (const p of players) totals[p.uid] = 0;

    for (const fixture of fx) {
      const actual = fixture.result ?? null;

      for (const p of players) {
        const pred = picks?.[fixture.fixtureId]?.[p.uid] ?? null;
        const g = golden[p.uid];
        const isGolden = !!g && g.fixtureId === fixture.fixtureId && g.score === (pred ?? "");
        totals[p.uid] += calculatePoints(pred, actual, isGolden);
      }
    }

    return totals;
  }

  // Build matrix: for all weeks 1..currentGw, fill 0 unless played
  useEffect(() => {
    if (players.length === 0) return;

    let cancelled = false;

    (async () => {
      setBusy(true);
      setError(null);

      // init matrix with zeros
      const matrix: Record<string, Record<number, number>> = {};
      for (const p of players) {
        matrix[p.uid] = {};
        for (let gw = 1; gw <= currentGw; gw++) matrix[p.uid][gw] = 0;
      }

      // Only calculate weeks that actually have a minigame doc
      // (prevents rate-limit bursts on Football-Data)
      const weeksToCompute = playedGws.filter((g) => g >= 1 && g <= currentGw);

      try {
        for (const gwNum of weeksToCompute) {
          if (cancelled) return;

          const [fx, picks, golden] = await Promise.all([
            getFixturesForGw(gwNum),
            getPicksForGw(gwNum),
            getGoldenForGw(gwNum),
          ]);

          const totals = computeGwTotals(fx, picks, golden);

          for (const p of players) {
            matrix[p.uid][gwNum] = totals[p.uid] ?? 0;
          }
        }

        if (!cancelled) setPointsByUserByGw(matrix);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to build leaderboard.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [players, playedGws, currentGw, roomCode]);

  const weeks = useMemo(() => Array.from({ length: currentGw }, (_, i) => i + 1), [currentGw]);

  const userTotal = (uid: string) =>
    weeks.reduce((sum, gw) => sum + (pointsByUserByGw?.[uid]?.[gw] ?? 0), 0);
  
  const grandTotal = () =>
    players.reduce((sum, p) => sum + userTotal(p.uid), 0);

  // Sort users by total desc
  const sortedPlayers = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => userTotal(b.uid) - userTotal(a.uid));
    return list;
  }, [players, pointsByUserByGw, currentGw]);

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Leaderboard</h1>
            <div className="text-sm text-gray-500">Room {roomCode}</div>
            <div className="text-xs text-gray-500">Showing GW1–GW{currentGw}</div>
          </div>

          <button
            onClick={() => router.push(`/room/${roomCode}`)}
            className="text-sm border rounded-lg px-4 py-2"
          >
            Back
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3">
            {error}
          </div>
        )}

        {busy && <div className="text-sm text-gray-500">Building leaderboard…</div>}

        <div className="overflow-x-auto border rounded-xl">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="p-3">Player</th>
                {weeks.map((w) => (
                  <th key={w} className="p-3 text-center">
                    GW{w}
                  </th>
                ))}
                <th className="p-3 text-center font-semibold">Total</th>
              </tr>
            </thead>

            <tbody>
              {sortedPlayers.map((p) => (
                <tr key={p.uid} className="border-t">
                  <td className="p-3 font-medium">{p.displayName}</td>

                  {weeks.map((w) => (
                    <td key={w} className="p-3 text-center">
                      {pointsByUserByGw?.[p.uid]?.[w] ?? 0}
                    </td>
                  ))}

                  <td className="p-3 text-center font-semibold">{userTotal(p.uid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-500">
          Weeks with no minigame played show 0. Golden doubles points (result ×2, exact ×2) per your rules.
        </div>
      </div>
    </div>
  );
}