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
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  const [picks, setPicks] = useState<PickDoc[]>([]);
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [displayNamesByUid, setDisplayNamesByUid] = useState<
    Record<string, string>
  >({});

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

        const st = String(data?.state ?? "")
          .trim()
          .toUpperCase();

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
      () => setError("Failed to load game state."),
    );

    return () => unsub();
  }, [user, roomCode, gw, router]);

  // load fixtures
  useEffect(() => {
    if (gw == null) return;
    let cancelled = false;

    (async () => {
      const r = await fetch(`/api/fixtures?gameweek=${gw}`, {
        cache: "no-store",
      });
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

    const qPicks = query(
      collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks"),
    );
    return onSnapshot(
      qPicks,
      (snap) => {
        const list: PickDoc[] = snap.docs.map((d) => d.data() as any);
        setPicks(list);
      },
      () => setError("Failed to listen for picks."),
    );
  }, [roomCode, gw]);

  // listen golden
  useEffect(() => {
    if (gw == null) return;

    const qGolden = query(
      collection(db, "rooms", roomCode, "games", `gw-${gw}`, "golden"),
    );
    return onSnapshot(
      qGolden,
      (snap) => {
        const map: Record<string, GoldenDoc> = {};
        for (const d of snap.docs) map[d.id] = d.data() as any;
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for goldens."),
    );
  }, [roomCode, gw]);

  // listen lobby display names (best-effort) so we can show names instead of UIDs
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
      () => {},
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
    for (const p of picks)
      m.set(`${p.uid}|${p.fixtureId}`, String(p.score ?? "").trim());
    return m;
  }, [picks]);

  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const allLocked = players.length > 0 && lockedCount >= players.length;

  if (loading || !user) return null;

  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-screen p-6 bg-app">
        <div className="text-sm text-muted">Loading reveal…</div>
      </div>
    );
  }

  const state = String(game.state ?? "").toUpperCase();
  if (state !== "REVEAL") {
    return (
      <div className="min-h-screen p-6 bg-app">
        <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card p-6 space-y-3 border border-subtle">
          <div className="text-xl font-semibold text-foreground">
            Reveal not ready
          </div>
          <div className="text-sm text-muted">Current state: {game.state}</div>
          <button
            className="text-sm rounded-lg px-4 py-2 bg-surface border border-subtle text-foreground hover:bg-surface-2"
            onClick={() => router.push(`/room/${roomCode}/minigame`)}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-app">
      <div className="max-w-4xl mx-auto bg-surface rounded-2xl shadow-card p-6 space-y-4 border border-subtle">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Predictions Overview
            </h1>
            <div className="text-sm text-muted">
              {roomCode} • GW {gw}
            </div>
          </div>

          <button
            className="text-sm rounded-lg px-4 py-2 bg-surface border border-subtle text-foreground hover:bg-surface-2"
            onClick={() => router.push(`/room/${roomCode}`)}
          >
            Exit
          </button>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-subtle text-danger">
            {error}
          </div>
        )}

        {!allLocked && (
          <div className="border border-subtle rounded-xl p-4 bg-surface-2">
            <div className="font-semibold text-foreground">
              Waiting for all golden picks…
            </div>
            <div className="text-sm text-muted mt-1">
              This screen will fill in as players lock.
            </div>
          </div>
        )}

        {/* Picks table */}
        <div className="overflow-auto border border-subtle rounded-xl bg-surface-2">
          <table className="min-w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="w-[260px] text-left p-3 border-b border-subtle text-foreground">
                  Fixture
                </th>

                {players.map((uid) => (
                  <th
                    key={uid}
                    className="w-[110px] text-left p-3 border-b border-subtle whitespace-nowrap font-semibold"
                  >
                    <span className="block truncate">
                      {displayNamesByUid[uid] ?? uid.slice(0, 6)}
                    </span>
                  </th>
                ))}

                <th className="w-[110px] text-left p-3 border-b border-subtle whitespace-nowrap text-foreground">
                  Actual
                </th>
              </tr>
            </thead>
            <tbody>
              {fixtureIds.map((fid) => {
                const f = fixtureMap.get(fid);
                const title = f
                  ? `${f.home.name} vs ${f.away.name}`
                  : `Fixture ${fid}`;
                const actual = f?.result ? fmtScore(f.result) : "TBD";

                return (
                  <tr
                    key={fid}
                    className="border-b border-subtle last:border-0"
                  >
                    <td className="p-3 align-top">
                      <div className="font-medium text-foreground">{title}</div>
                    </td>

                    {players.map((uid) => {
                      const sc = picksByUserFixture.get(`${uid}|${fid}`) || "";
                      const g = goldensByUid[uid];
                      const isGolden = g?.locked && g?.fixtureId === fid;

                      return (
                        <td key={uid} className="p-3 align-top">
                          <div
                            className={[
                              "inline-flex items-center justify-center rounded-lg px-2 py-1 border border-subtle whitespace-nowrap min-w-[56px]",
                              isGolden
                                ? "bg-yellow-300 font-bold text-black"
                                : "bg-surface-2 text-foreground",
                            ].join(" ")}
                          >
                            {fmtScore(sc)}
                          </div>
                        </td>
                      );
                    })}

                    <td className="p-3 align-top">
                      <div className="inline-flex items-center justify-center rounded-lg px-2 py-1 bg-surface-2 border border-subtle text-foreground whitespace-nowrap min-w-[56px]">
                        {actual}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
