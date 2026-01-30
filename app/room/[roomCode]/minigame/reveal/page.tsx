"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import { db } from "../../../../../firebase";
import { collection, doc, onSnapshot, query } from "firebase/firestore";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  players: string[];
  order?: string[];
  fixtureIds: number[];
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: { name: string };
  away: { name: string };
  result?: string | null;
};

type PickDoc = {
  uid: string;
  fixtureId: number;
  score: string; // "2-1"
};

type GoldenDoc = {
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
};

function fmtScore(s?: string | null) {
  if (!s) return "—";
  return s.replace("-", "–");
}

export default function RevealPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  const [picks, setPicks] = useState<PickDoc[]>([]);
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>({});
  const [displayNamesByUid, setDisplayNamesByUid] = useState<Record<string, string>>({});

  const routedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  // current GW
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/current-gameweek", { cache: "no-store" });
        const data = await res.json();
        const n = Number(data?.currentGameweek ?? 1);
        if (!cancelled) setGw(Number.isFinite(n) ? n : 1);
      } catch {
        if (!cancelled) setGw(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // listen to game doc (for routing + player list + fixtureIds)
  useEffect(() => {
    if (!user || gw == null) return;

    const gameRef = doc(db, "rooms", roomCode, "games", `gw-${gw}`);
    const unsub = onSnapshot(
      gameRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        setGame(data);

        const st = String(data?.state ?? "").trim().toUpperCase();

        if (routedRef.current) return;

        // keep navigation consistent
        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
        } else if (st === "GOLDEN") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/golden`);
        } else if (st === "LOBBY") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame`);
        }
      },
      () => setError("Failed to load game state.")
    );

    return () => unsub();
  }, [user, roomCode, gw, router]);

  // load fixtures
  useEffect(() => {
    if (gw == null) return;
    let cancelled = false;

    (async () => {
      const r = await fetch(`/api/fixtures?gameweek=${gw}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      const fx: Fixture[] = Array.isArray(d?.fixtures) ? d.fixtures : [];
      if (!cancelled) setFixtures(fx);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw]);

  // listen picks
  useEffect(() => {
    if (gw == null) return;

    const qPicks = query(collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks"));
    return onSnapshot(
      qPicks,
      (snap) => {
        const list: PickDoc[] = snap.docs.map((d) => d.data() as any);
        setPicks(list);
      },
      () => setError("Failed to listen for picks.")
    );
  }, [roomCode, gw]);

  // listen golden
  useEffect(() => {
    if (gw == null) return;

    const qGolden = query(collection(db, "rooms", roomCode, "games", `gw-${gw}`, "golden"));
    return onSnapshot(
      qGolden,
      (snap) => {
        const map: Record<string, GoldenDoc> = {};
        for (const d of snap.docs) map[d.id] = d.data() as any;
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for goldens.")
    );
  }, [roomCode, gw]);

  // listen lobby display names (best-effort) so we can show names instead of UIDs
  // We'll read from room players collection (membership) for labels
  useEffect(() => {
    const qPlayers = query(collection(db, "rooms", roomCode, "players"));
    return onSnapshot(
      qPlayers,
      (snap) => {
        const map: Record<string, string> = {};
        for (const d of snap.docs) {
          const data = d.data() as any;
          map[d.id] = data?.displayName || "Player";
        }
        setDisplayNamesByUid(map);
      },
      () => {}
    );
  }, [roomCode]);

  const players = useMemo(() => {
    // Prefer order if present (nice stable ordering)
    const arr = (game?.order?.length ? game.order : game?.players) ?? [];
    return Array.isArray(arr) ? arr : [];
  }, [game]);

  const fixtureIds = useMemo(() => {
    if (game?.fixtureIds?.length) return game.fixtureIds;
    return (fixtures ?? []).map((f) => f.fixtureId);
  }, [game, fixtures]);

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByUserFixture = useMemo(() => {
    const m = new Map<string, string>(); // key = uid|fixtureId
    for (const p of picks) m.set(`${p.uid}|${p.fixtureId}`, String(p.score ?? "").trim());
    return m;
  }, [picks]);

  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const allLocked = players.length > 0 && lockedCount >= players.length;

  if (loading || !user) return null;

  if (gw == null || fixtures == null || !game) {
    return <div className="min-h-screen p-6 bg-gray-50">Loading reveal…</div>;
  }

  const state = String(game.state ?? "").toUpperCase();
  if (state !== "REVEAL") {
    return (
      <div className="min-h-screen p-6 bg-gray-50">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-6 space-y-3">
          <div className="text-xl font-semibold">Reveal not ready</div>
          <div className="text-sm text-gray-600">Current state: {game.state}</div>
          <button
            className="text-sm border rounded-lg px-4 py-2"
            onClick={() => router.push(`/room/${roomCode}/minigame`)}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Reveal</h1>
            <div className="text-sm text-gray-500">Room {roomCode} • GW {gw}</div>
            <div className="text-xs text-gray-500">
              Golden locked: {lockedCount}/{players.length}
            </div>
          </div>

          <button
            className="text-sm border rounded-lg px-4 py-2"
            onClick={() => router.push(`/room/${roomCode}`)}
          >
            Exit
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3">
            {error}
          </div>
        )}

        {!allLocked && (
          <div className="border rounded-xl p-4">
            <div className="font-semibold">Waiting for all golden picks…</div>
            <div className="text-sm text-gray-600 mt-1">
              This screen will fill in as players lock.
            </div>
          </div>
        )}

        {/* Picks table */}
        <div className="overflow-auto border rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 border-b">Fixture</th>
                {players.map((uid) => (
                  <th key={uid} className="text-left p-3 border-b whitespace-nowrap">
                    {displayNamesByUid[uid] ?? uid.slice(0, 6)}
                    {goldensByUid[uid]?.locked ? (
                      <span className="ml-2 text-xs bg-yellow-100 rounded-full px-2 py-0.5">
                        Golden
                      </span>
                    ) : null}
                  </th>
                ))}
                <th className="text-left p-3 border-b whitespace-nowrap">Actual</th>
              </tr>
            </thead>

            <tbody>
              {fixtureIds.map((fid) => {
                const f = fixtureMap.get(fid);
                const title = f ? `${f.home.name} vs ${f.away.name}` : `Fixture ${fid}`;
                const actual = f?.result ? fmtScore(f.result) : "TBD";

                return (
                  <tr key={fid} className="border-b last:border-0">
                    <td className="p-3 align-top">
                      <div className="font-medium">{title}</div>
                      {f && (
                        <div className="text-xs text-gray-500">
                          {new Date(f.kickoff).toLocaleString()} • {String(f.status).toUpperCase()}
                        </div>
                      )}
                    </td>

                    {players.map((uid) => {
                      const sc = picksByUserFixture.get(`${uid}|${fid}`) || "";
                      const g = goldensByUid[uid];
                      const isGolden = g?.locked && g?.fixtureId === fid;

                      return (
                        <td key={uid} className="p-3 align-top">
                          <div
                            className={[
                              "inline-block rounded-lg px-2 py-1",
                              isGolden ? "bg-yellow-100 font-semibold" : "bg-gray-50",
                            ].join(" ")}
                          >
                            {fmtScore(sc)}
                          </div>
                        </td>
                      );
                    })}

                    <td className="p-3 align-top">
                      <div className="inline-block rounded-lg px-2 py-1 bg-gray-50">
                        {actual}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-500">
          Next: leaderboard/points calculation (we’ll compute 2x/4x for each player’s golden fixture).
        </div>
      </div>
    </div>
  );
}