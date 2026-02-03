"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import { db } from "../../../../../firebase";
import { collection, doc, onSnapshot, query } from "firebase/firestore";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  players: string[];
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

export default function GoldenPage() {
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

  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [myPicksByFixture, setMyPicksByFixture] = useState<
    Record<number, string>
  >({});

  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(
    null,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routedRef = useRef(false);

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

  // listen to game doc (for state + players + fixtureIds + auto route)
  useEffect(() => {
    if (!user || gw == null) return;

    const gameRef = doc(db, "rooms", roomCode, "games", `gw-${gw}`);

    const unsub = onSnapshot(
      gameRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as GameDoc) : null;
        setGame(data);

        const st = String(data?.state ?? "")
          .trim()
          .toUpperCase();

        if (routedRef.current) return;

        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
          return;
        }

        if (st === "REVEAL") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/reveal`);
          return;
        }
      },
      () => setError("Failed to load game state."),
    );

    return () => unsub();
  }, [user, roomCode, gw, router]);

  // load fixtures for GW
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

  // listen to ALL picks for this GW
  useEffect(() => {
    if (gw == null) return;

    const picksQ = query(
      collection(db, "rooms", roomCode, "games", `gw-${gw}`, "picks"),
    );

    return onSnapshot(
      picksQ,
      (snap) => {
        const list: PickDoc[] = snap.docs.map((d) => d.data() as PickDoc);
        setAllPicks(list);

        if (user) {
          const mine: Record<number, string> = {};
          for (const p of list) {
            if (p.uid === user.uid) mine[p.fixtureId] = p.score;
          }
          setMyPicksByFixture(mine);

          if (selectedFixtureId == null) {
            const first = Object.keys(mine)[0];
            if (first) setSelectedFixtureId(Number(first));
          }
        }
      },
      () => setError("Failed to listen for picks."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, gw, user?.uid]);

  // listen to golden locks
  useEffect(() => {
    if (gw == null) return;

    const goldenQ = query(
      collection(db, "rooms", roomCode, "games", `gw-${gw}`, "golden"),
    );

    return onSnapshot(
      goldenQ,
      (snap) => {
        const map: Record<string, GoldenDoc> = {};
        for (const d of snap.docs) {
          map[d.id] = d.data() as GoldenDoc;
        }
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for golden locks."),
    );
  }, [roomCode, gw]);

  const playersCount = game?.players?.length ?? 0;
  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const myGolden = user ? goldensByUid[user.uid] : undefined;
  const myGoldenLocked = !!myGolden?.locked;

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByFixture = useMemo(() => {
    const m = new Map<number, PickDoc[]>();
    for (const p of allPicks) {
      if (!m.has(p.fixtureId)) m.set(p.fixtureId, []);
      m.get(p.fixtureId)!.push(p);
    }
    return m;
  }, [allPicks]);

  async function lockGolden() {
    if (!user) return;
    if (gw == null) return;

    if (selectedFixtureId == null) {
      setError("Select a fixture to make golden.");
      return;
    }

    const score = myPicksByFixture[selectedFixtureId];
    if (!score) {
      setError("You can only choose golden from a fixture you picked.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/game/golden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw,
          uid: user.uid,
          fixtureId: selectedFixtureId,
          score,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to lock golden.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to lock golden.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;
  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="text-sm text-muted">Loading golden…</div>
      </div>
    );
  }

  if (String(game.state).toUpperCase() !== "GOLDEN") {
    return (
      <div className="min-h-[100dvh] p-6 bg-app">

        <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 border border-teal-500">
          <div className="text-lg font-semibold text-foreground">
            Not in Golden phase
          </div>
          <div className="text-sm text-muted mt-1">
            Current state: {game.state}
          </div>
        </div>
      </div>
    );
  }

  const orderedFixtureIds = game.fixtureIds?.length
    ? game.fixtureIds
    : fixtures.map((f) => f.fixtureId);

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Golden Pick
            </h1>
            <div className="text-sm text-muted">
              Room {roomCode} • GW {gw} Golden Picks
            </div>
            <div className="text-xs text-muted">
              Locked: {lockedCount}/{playersCount}
            </div>
          </div>

        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {/* If locked, show waiting room */}
        {myGoldenLocked ? (
          <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
            <div className="font-semibold text-foreground">
              You’re locked in ✅
            </div>
            <div className="text-sm text-muted mt-1">
              Golden fixture:{" "}
              <span className="font-semibold text-foreground">
                {myGolden.fixtureId} ({String(myGolden.score).replace("-", "–")}
                )
              </span>
            </div>

            <div className="mt-4 w-full h-2 bg-surface border border-teal-500 rounded">
              <div
                className="h-2 bg-accent rounded"
                style={{
                  width:
                    playersCount > 0
                      ? `${Math.round((lockedCount / playersCount) * 100)}%`
                      : "0%",
                }}
              />
            </div>
            <div className="text-xs text-muted mt-2">
              Waiting for others to lock their golden pick…
            </div>
          </div>
        ) : (
          <>
            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
              <div className="font-semibold mb-2 text-foreground">
                Choose your Golden fixture
              </div>
              <div className="text-sm text-muted">
                Your golden doubles points:
                <ul className="list-disc pl-5 mt-1">
                  <li>
                    Correct result = <b className="text-foreground">2 points</b>
                  </li>
                  <li>
                    Correct score = <b className="text-foreground">4 points</b>
                  </li>
                  <li>
                    Otherwise = <b className="text-foreground">0</b>
                  </li>
                </ul>
              </div>
            </div>

            <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
              {orderedFixtureIds.map((fid) => {
                const f = fixtureMap.get(fid);
                const myScore = myPicksByFixture[fid];

                const others = (picksByFixture.get(fid) ?? [])
                  .filter((p) => p.uid !== user.uid)
                  .map((p) => p.score);

                const isSelected = selectedFixtureId === fid;

                return (
                  <button
                    key={fid}
                    type="button"
                    onClick={() => setSelectedFixtureId(fid)}
                    disabled={!myScore}
                    className={[
                      "w-full text-left rounded-xl p-3 border transition-colors",
                      isSelected
                        ? "border-yellow-400 bg-yellow-500/10"
                        : "border-teal-500",
                      !myScore
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:bg-surface hover:border-teal-400",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">
                          {f
                            ? `${f.home.name} vs ${f.away.name}`
                            : `Fixture ${fid}`}
                        </div>
                        <div className="text-xs text-muted">
                          {f ? new Date(f.kickoff).toLocaleString() : ""}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm text-muted">Your pick</div>
                        <div className="text-lg font-semibold text-foreground">
                          {myScore ? myScore.replace("-", "–") : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-muted">
                      Other picks:{" "}
                      {others.length === 0 ? (
                        <span>none</span>
                      ) : (
                        <span>
                          {others.slice(0, 10).join(", ").replaceAll("-", "–")}
                        </span>
                      )}
                    </div>

                    {!myScore && (
                      <div className="mt-2 text-xs text-danger">
                        You didn’t pick this fixture (can’t be golden).
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={lockGolden}
              disabled={
                submitting ||
                selectedFixtureId == null ||
                !myPicksByFixture[selectedFixtureId]
              }
              className="w-full rounded-xl py-4 bg-accent text-accent-foreground disabled:opacity-60"
            >
              {submitting ? "Locking…" : "Lock Golden Pick"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
