"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../components/AuthProvider";
import { db } from "../../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import { coerceMillis, ONE_HOUR_MS } from "../lock-utils";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "REVEAL";
  players: string[];
  fixtureIds: number[];
  lockAt?: unknown;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
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
const BTN_3D = "btn-3d-accent";

function TeamBadge({
  name,
  tla,
  shortName,
  badge,
}: {
  name: string;
  tla?: string | null;
  shortName?: string;
  badge?: string | null;
}) {
  const fallback = teamAbbr(name, tla, shortName);
  return (
    <div className="h-10 w-10 rounded-full flex items-center justify-center overflow-hidden shrink-0">
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={badge} alt={name} className="h-8 w-8 object-contain" loading="lazy" />
      ) : (
        <span className="text-[10px] font-bold text-foreground">{fallback}</span>
      )}
    </div>
  );
}

function teamAbbr(name: string, tla?: string | null, shortName?: string) {
  const tlaCode = String(tla || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(tlaCode)) return tlaCode;

  const short = String(shortName || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(short)) return short;

  const clean = String(name || "").trim().toUpperCase();
  if (!clean) return "FC";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("");
  }
  return clean.slice(0, 3);
}

function formatFixtureDateParts(iso: string) {
  const dt = new Date(iso);
  const day = dt.getDate();
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? "st"
      : day % 10 === 2 && day % 100 !== 12
        ? "nd"
        : day % 10 === 3 && day % 100 !== 13
          ? "rd"
          : "th";
  const monthYear = dt.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
  return { day, suffix, monthYear };
}

export default function GoldenPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
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
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [compactOtherPicks, setCompactOtherPicks] = useState(false);

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
        const data = await getCurrentGameweekCached();
        const n = Number(data.currentGameweek ?? 1);
        if (!cancelled) {
          setGw(Number.isFinite(n) ? n : 1);
          setSeasonKey(String(data.seasonKey || ""));
        }
      } catch {
        if (!cancelled) {
          setGw(1);
          setSeasonKey("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("goldenCompactOtherPicks");
    setCompactOtherPicks(raw === "1");
  }, []);

  // listen to game doc (for state + players + fixtureIds + auto route)
  useEffect(() => {
    if (!user || gw == null || !seasonKey) return;

    const gameRef = doc(
      db,
      "rooms",
      roomCode,
      "seasons",
      seasonKey,
      "games",
      `gw-${gw}`,
    );

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
  }, [user, roomCode, gw, router, seasonKey]);

  // load fixtures for GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const r = await fetch(`/api/fixtures?gameweek=${gw}&seasonKey=${seasonKey}`, {
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      const fx: Fixture[] = Array.isArray(d?.fixtures) ? d.fixtures : [];
      if (!cancelled) setFixtures(fx);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw, seasonKey]);

  // listen to ALL picks for this GW
  useEffect(() => {
    if (gw == null || !seasonKey) return;

    const picksQ = query(
      collection(
        db,
        "rooms",
        roomCode,
        "seasons",
        seasonKey,
        "games",
        `gw-${gw}`,
        "picks",
      ),
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
  }, [roomCode, gw, user?.uid, seasonKey]);

  // listen to golden locks
  useEffect(() => {
    if (gw == null || !seasonKey) return;

    const goldenQ = query(
      collection(
        db,
        "rooms",
        roomCode,
        "seasons",
        seasonKey,
        "games",
        `gw-${gw}`,
        "golden",
      ),
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
  }, [roomCode, gw, seasonKey]);

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
    if (isLocked) {
      setError("Mini-game is locked (deadline passed).");
      return;
    }

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
          seasonKey,
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

  function toggleCompactOtherPicks() {
    setCompactOtherPicks((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("goldenCompactOtherPicks", next ? "1" : "0");
      }
      return next;
    });
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

        <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 border border-subtle">
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
  const gameLockAtMs = coerceMillis(game?.lockAt);
  const fallbackLockAtMs = fixtures.length
    ? fixtures
        .map((f) => Date.parse(String(f.kickoff || "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)[0] - ONE_HOUR_MS
    : null;
  const lockAtMs =
    gameLockAtMs ??
    (Number.isFinite(fallbackLockAtMs ?? NaN) ? fallbackLockAtMs : null);
  const isLocked = lockAtMs != null && nowMs >= lockAtMs;

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-subtle">
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
          <div className="rounded-xl p-3 bg-surface-2 border border-subtle text-danger">
            {error}
          </div>
        )}

        {/* If locked, show waiting room */}
        {myGoldenLocked ? (
          <div className="border border-subtle rounded-xl p-4 bg-surface-2">
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

            <div className="mt-4 w-full h-2 bg-surface border border-subtle rounded">
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
            <div className="border border-subtle rounded-xl p-4 bg-surface-2">
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

	            <div className="border border-subtle rounded-xl p-4 bg-surface-2">
	              <div className="mb-3 flex items-center justify-end">
	                <label className="inline-flex items-center gap-2 text-xs text-foreground select-none">
	                  <span>Compact Other Picks</span>
	                  <button
	                    type="button"
	                    role="switch"
	                    aria-checked={compactOtherPicks}
	                    onClick={toggleCompactOtherPicks}
	                    className={[
	                      `relative h-6 w-11 rounded-full border transition-colors ${BTN_3D}`,
	                      compactOtherPicks
	                        ? "bg-yellow-500/20 border-yellow-400/80"
	                        : "bg-surface border-subtle",
	                    ].join(" ")}
	                  >
	                    <span
	                      className={[
	                        "absolute top-0.5 h-4 w-4 rounded-full bg-foreground transition-all",
	                        compactOtherPicks ? "left-6" : "left-0.5",
	                      ].join(" ")}
	                    />
	                  </button>
	                </label>
	              </div>
	              <div className="grid grid-cols-2 gap-3">
	              {orderedFixtureIds.map((fid) => {
	                const f = fixtureMap.get(fid);
	                const myScore = myPicksByFixture[fid];
	                const kickoff = f ? new Date(f.kickoff) : null;
	                const kickoffDate = kickoff ? formatFixtureDateParts(f.kickoff) : null;
	                const kickoffTime = kickoff
	                  ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
	                  : "";

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
	                      "w-full h-full text-left rounded-xl p-3 border transition-all duration-200",
	                      isSelected
	                        ? "border-yellow-400/90 bg-gradient-to-b from-yellow-500/15 to-amber-400/5 shadow-[0_10px_22px_rgba(250,204,21,0.20)] -translate-y-[1px]"
	                        : "border-subtle",
	                      !myScore
	                        ? "opacity-60 cursor-not-allowed"
	                        : "hover:bg-surface hover:border-subtle hover:-translate-y-[1px]",
	                    ].join(" ")}
	                  >
	                    <div className="space-y-2">
	                      <div className="flex flex-col items-center text-xs text-muted">
	                        <div>
	                          {kickoffDate ? (
	                            <>
	                              {kickoffDate.day}
	                              <span
	                                className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold"
	                                aria-hidden="true"
	                              >
	                                {kickoffDate.suffix}
	                              </span>{" "}
	                              {kickoffDate.monthYear}
	                            </>
	                          ) : null}
	                        </div>
	                        <div className="font-semibold tabular-nums mt-0.5">{kickoffTime}</div>
	                      </div>
	                      <div>
	                        {f ? (
	                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
	                            <div className="flex flex-col items-center text-center min-w-0">
                              <TeamBadge
                                name={f.home.name}
                                tla={f.home.tla}
                                shortName={f.home.shortName}
                                badge={f.home.badge}
                              />
                              <div className="mt-1 w-full text-center font-semibold text-foreground">
                                <span className="sm:hidden text-[11px]">
                                  {teamAbbr(f.home.name, f.home.tla, f.home.shortName)}
                                </span>
                                <span className="hidden sm:inline text-xs truncate w-full">
                                  {f.home.name}
                                </span>
                              </div>
	                            </div>
	                            <div className="text-xs text-muted uppercase">vs</div>
	                            <div className="flex flex-col items-center text-center min-w-0">
                              <TeamBadge
                                name={f.away.name}
                                tla={f.away.tla}
                                shortName={f.away.shortName}
                                badge={f.away.badge}
                              />
                              <div className="mt-1 w-full text-center font-semibold text-foreground">
                                <span className="sm:hidden text-[11px]">
                                  {teamAbbr(f.away.name, f.away.tla, f.away.shortName)}
                                </span>
                                <span className="hidden sm:inline text-xs truncate w-full">
                                  {f.away.name}
                                </span>
	                              </div>
	                            </div>
	                          </div>
	                        ) : (
	                          <div className="font-semibold text-foreground">Fixture {fid}</div>
	                        )}
	                      </div>
	                      <div
	                        className={[
	                          "mt-2 rounded-lg border px-3 py-2 text-center transition-all duration-200",
	                          isSelected
	                            ? "border-yellow-300/90 bg-gradient-to-r from-yellow-500/20 via-amber-300/8 to-yellow-500/20 shadow-[0_8px_18px_rgba(250,204,21,0.22)]"
	                            : "border-subtle bg-surface",
	                        ].join(" ")}
	                      >
	                        <div className="text-xs text-muted">Your pick</div>
	                        <div className="text-lg font-semibold text-foreground tabular-nums">
	                          {myScore ? myScore.replace("-", " - ") : "—"}
	                        </div>
	                      </div>
	                    </div>

	                    <div className="mt-3">
	                      {!compactOtherPicks && (
	                        <div className="text-xs text-muted text-center">Other picks</div>
	                      )}
	                      {others.length === 0 ? (
	                        <div className={`text-xs text-muted text-center ${compactOtherPicks ? "" : "mt-1"}`}>
	                          None
	                        </div>
	                      ) : compactOtherPicks ? (
	                        <div className="text-xs text-muted text-center">
	                        </div>
	                      ) : (
	                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
	                          {others.slice(0, 10).map((score, idx) => (
	                            <span
	                              key={`${fid}-other-${idx}-${score}`}
	                              className="rounded-full border border-subtle px-2.5 py-1 text-xs text-foreground tabular-nums"
	                            >
	                              {String(score).replace("-", " - ")}
	                            </span>
	                          ))}
	                        </div>
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
	            </div>

            <button
              onClick={lockGolden}
              disabled={
                submitting ||
                isLocked ||
                selectedFixtureId == null ||
                !myPicksByFixture[selectedFixtureId]
              }
              className={`w-full rounded-xl py-4 bg-accent text-accent-foreground disabled:opacity-60 ${BTN_3D}`}
            >
              {submitting ? "Locking…" : "Lock Golden Pick"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
