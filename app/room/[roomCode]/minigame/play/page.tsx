"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import { db } from "../../../../../firebase";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  order: string[];
  fixtureIds: number[];
  currentTurn: number;
  totalTurns: number;
  players: string[];
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: { name: string };
  away: { name: string };
  result?: string | null;
};

function onlyDigitsOrEmpty(v: string) {
  return v === "" || /^\d+$/.test(v);
}

export default function MiniGamePlayPage() {
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

  const [takenScores, setTakenScores] = useState<string[]>([]);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        const r = await fetch("/api/current-gameweek");
        const d = await r.json();
        const n = Number(d?.currentGameweek ?? 1);
        if (!cancelled) setGw(Number.isFinite(n) ? n : 1);
      } catch {
        if (!cancelled) setGw(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // load fixtures for GW
  useEffect(() => {
    if (gw == null) return;
    let cancelled = false;

    (async () => {
      const r = await fetch(`/api/fixtures?gameweek=${gw}`);
      const d = await r.json();
      if (!cancelled) setFixtures(Array.isArray(d?.fixtures) ? d.fixtures : []);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw]);

  // listen to game doc
  useEffect(() => {
    if (gw == null) return;
    const gameRef = doc(db, "rooms", roomCode, "games", `gw-${gw}`);
    return onSnapshot(gameRef, (snap) => {
      setGame(snap.exists() ? (snap.data() as any) : null);
    });
  }, [roomCode, gw]);

  const current = useMemo(() => {
    if (!game) return null;
    const order = game.order || [];
    const fixtureIds = game.fixtureIds || [];
    const turn = game.currentTurn ?? 0;
    if (!order.length || !fixtureIds.length) return null;

    const P = order.length;
    const fixtureIndex = Math.floor(turn / P);
    if (fixtureIndex >= fixtureIds.length) return null;

    const turnInFixture = turn % P;

    // ✅ ROTATION: each new fixture shifts who goes first
    const rotatedIndex = (turnInFixture + fixtureIndex) % P;

    const uidTurn = order[rotatedIndex];
    const fixtureId = fixtureIds[fixtureIndex];

    return {
      uidTurn,
      fixtureId,
      fixtureIndex,
      turn,
      rotatedIndex,
      turnInFixture,
    };
  }, [game]);

  const amITurn = !!user && !!current && current.uidTurn === user.uid;

  // listen to taken scores for current fixture
  useEffect(() => {
    if (gw == null || !current) return;

    const picksQ = query(
      collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks"),
      where("fixtureId", "==", current.fixtureId),
    );

    return onSnapshot(picksQ, (snap) => {
      const scores = snap.docs.map((d) => String((d.data() as any).score));
      setTakenScores(scores);
    });
  }, [roomCode, gw, current]);

  useEffect(() => {
    // reset inputs when fixture changes
    setHomeScore("");
    setAwayScore("");
    setErr(null);
  }, [current?.fixtureId]);

  if (gw == null || fixtures == null) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Game not started yet.</div>
      </div>
    );
  }

  // phase routing
  if (game.state === "GOLDEN") {
    router.replace(`/room/${roomCode}/minigame/golden`);
    return null;
  }
  if (game.state === "REVEAL") {
    router.replace(`/room/${roomCode}/minigame/reveal`);
    return null;
  }

  const fixture = fixtures.find((f) => f.fixtureId === current?.fixtureId);

  const submitPick = async () => {
    if (!current || !user) return;
    if (homeScore === "" || awayScore === "") {
      setErr("Enter both scores.");
      return;
    }
    const score = `${homeScore}-${awayScore}`;
    if (takenScores.includes(score)) {
      setErr("That score is already taken for this fixture.");
      return;
    }

    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/game/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, gw, uid: user.uid, score }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Pick failed");
    } catch (e: any) {
      setErr(e?.message ?? "Pick failed");
    } finally {
      setSubmitting(false);
    }
  };

  const progress = Math.min(
    1,
    (game.currentTurn ?? 0) / (game.totalTurns ?? 1),
  );

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card p-6 space-y-4 border border-subtle">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted">
              Room {roomCode} • GW {gw}
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              Predicicton Round-Robin
            </h1>
          </div>
        </div>

        {/* progress bar */}
        <div className="w-full h-2 bg-surface-2 border border-subtle rounded">
          <div
            className="h-2 bg-accent rounded"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="text-xs text-muted">
          Turn {game.currentTurn + 1} of {game.totalTurns}
        </div>

        {/* fixture */}
        <div className="border border-subtle rounded-xl p-4 bg-surface-2">
          <div className="font-semibold mb-1 text-foreground">
            {fixture
              ? `${fixture.home.name} vs ${fixture.away.name}`
              : `Fixture ${current?.fixtureId}`}
          </div>

          <div className="text-xs text-muted">
            {fixture ? new Date(fixture.kickoff).toLocaleString() : ""}
          </div>

          <div className="mt-3 text-sm">
            <div className="font-semibold mb-2 text-foreground">
              Taken scores
            </div>

            {takenScores.length === 0 ? (
              <div className="text-muted">None yet</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {takenScores.map((s) => (
                  <span
                    key={s}
                    className="text-xs bg-surface border border-subtle rounded-full px-2 py-1 text-foreground"
                  >
                    {s.replace("-", "–")}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {err && (
          <div className="rounded-xl p-3 bg-surface-2 border border-subtle text-danger">
            {err}
          </div>
        )}

        {/* your turn or waiting */}
        {amITurn ? (
          <div className="border border-subtle rounded-xl p-4 space-y-3 bg-surface-2">
            <div className="font-semibold text-foreground">Your turn</div>

            <div className="flex items-center justify-center gap-3">
              <input
                value={homeScore}
                onChange={(e) =>
                  onlyDigitsOrEmpty(e.target.value) &&
                  setHomeScore(e.target.value)
                }
                className="w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-subtle focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0"
                inputMode="numeric"
              />
              <span className="text-2xl text-muted">-</span>
              <input
                value={awayScore}
                onChange={(e) =>
                  onlyDigitsOrEmpty(e.target.value) &&
                  setAwayScore(e.target.value)
                }
                className="w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-subtle focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0"
                inputMode="numeric"
              />
            </div>

            <button
              disabled={submitting}
              onClick={submitPick}
              className="w-full rounded-lg px-4 py-3 bg-accent text-accent-foreground disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Confirm score"}
            </button>
          </div>
        ) : (
          <div className="border border-subtle rounded-xl p-4 bg-surface-2 text-foreground">
            Waiting for the current player to pick…
          </div>
        )}
      </div>
    </div>
  );
}
