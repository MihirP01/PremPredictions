// Minigame Lobby page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getCountdownParts, ONE_HOUR_MS } from "./lock-utils";

type LobbyPlayer = { uid: string; displayName: string };
type RoomPlayerDoc = { displayName?: string; nickName?: string };
type UserDoc = { displayName?: string; nickName?: string };
type LobbyDoc = { displayName?: string };
type GameStateDoc = { state?: string };
type RoomDoc = { leaderUid?: string; settings?: { sameResultLock?: boolean } };
type Fixture = { kickoff?: string };

export default function MiniGameLobbyPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );

  const { user, loading } = useAuth();
  const router = useRouter();

  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [gameweek, setGameweek] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);

  const [myDisplayName, setMyDisplayName] = useState<string>("Player");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<LobbyPlayer[]>([]);
  const [roomPlayersCount, setRoomPlayersCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [sameResultLockEnabled, setSameResultLockEnabled] = useState<boolean>(true);
  const [lockAtMs, setLockAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const isLeader = !!user && leaderUid === user.uid;

  // Track current lobby doc ref so we can reliably remove it on back/logout/unmount
  const lobbyRefRef = useRef<ReturnType<typeof doc> | null>(null);

  // 1) Auth guard + load room leader
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    (async () => {
      const roomSnap = await getDoc(doc(db, "rooms", roomCode));
      if (!roomSnap.exists()) {
        router.replace("/room-gate");
        return;
      }
      if (!cancelled) {
        const roomData = roomSnap.data() as RoomDoc | undefined;
        setLeaderUid(roomData?.leaderUid ?? null);
        setSameResultLockEnabled(roomData?.settings?.sameResultLock !== false);
      }
    })().catch(() => setError("Failed to load room."));

    return () => {
      cancelled = true;
    };
  }, [loading, user, router, roomCode]);

  // 2) Load current gameweek (lobby is tied to GW)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await getCurrentGameweekCached();
      const gw = Number(data.currentGameweek ?? 1);
      if (!cancelled) {
        setGameweek(Number.isFinite(gw) ? gw : 1);
        setSeasonKey(String(data.seasonKey || ""));
      }
    })().catch(() => {
      if (!cancelled) {
        setGameweek(1);
        setSeasonKey("");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 3) Resolve best display name (don’t rely on auth.user.displayName)
  // Priority:
  //   a) rooms/{roomCode}/players/{uid}.displayName
  //   b) users/{uid}.displayName
  //   c) email prefix
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      const emailFallback = user.email?.split("@")[0] || "Player";

      try {
        const roomPlayerSnap = await getDoc(
          doc(db, "rooms", roomCode, "players", user.uid),
        );
        if (roomPlayerSnap.exists()) {
          const roomData = roomPlayerSnap.data() as UserDoc;
          const dn = String(roomData?.nickName || "").trim() || roomData?.displayName;
          if (!cancelled && dn) {
            setMyDisplayName(dn);
            return;
          }
        }
      } catch {}

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          const dn = (userSnap.data() as UserDoc)?.displayName;
          if (!cancelled && dn) {
            setMyDisplayName(dn);
            return;
          }
        }
      } catch {}

      if (!cancelled) setMyDisplayName(emailFallback);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, roomCode]);

  useEffect(() => {
    if (gameweek == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const res = await fetch(
        `/api/fixtures?gameweek=${gameweek}&seasonKey=${seasonKey}`,
        {
          cache: "no-store",
        },
      );
      const data = await res.json().catch(() => ({}));
      const fixtures: Fixture[] = Array.isArray(data?.fixtures)
        ? data.fixtures
        : [];

      const firstKickoff = fixtures
        .map((f) => Date.parse(String(f.kickoff || "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)[0];

      if (!cancelled) {
        setLockAtMs(
          Number.isFinite(firstKickoff) ? firstKickoff - ONE_HOUR_MS : null,
        );
      }
    })().catch(() => {
      if (!cancelled) setLockAtMs(null);
    });

    return () => {
      cancelled = true;
    };
  }, [gameweek, seasonKey]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 4) Presence: join lobby on enter, heartbeat, leave on exit
  useEffect(() => {
    if (!user || gameweek == null || !seasonKey) return;

    const gwId = `gw-${gameweek}`;
    const lobbyRef = doc(
      db,
      "rooms",
      roomCode,
      "seasons",
      seasonKey,
      "games",
      gwId,
      "lobby",
      user.uid,
    );
    lobbyRefRef.current = lobbyRef;

    let stopped = false;

    const upsertPresence = async () => {
      if (stopped) return;
      await setDoc(
        lobbyRef,
        {
          uid: user.uid,
          displayName: myDisplayName,
          joinedAt: serverTimestamp(), // merge keeps existing if set earlier
          lastSeenAt: serverTimestamp(),
        },
        { merge: true },
      );
    };

    // initial join
    upsertPresence().catch(() => {});

    // heartbeat
    const t = setInterval(() => {
      upsertPresence().catch(() => {});
    }, 15000);

    return () => {
      stopped = true;
      clearInterval(t);
      deleteDoc(lobbyRef).catch(() => {});
    };
  }, [user, roomCode, gameweek, myDisplayName, seasonKey]);

  // 5) Listen to lobby players (ONLY minigame lobby, not room members)
  useEffect(() => {
    if (!user || gameweek == null || !seasonKey) return;

    const gwId = `gw-${gameweek}`;
    const q = query(
      collection(db, "rooms", roomCode, "seasons", seasonKey, "games", gwId, "lobby"),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: LobbyPlayer[] = snap.docs.map((d) => {
          const data = d.data() as LobbyDoc;
          return {
            uid: d.id,
            displayName: data?.displayName || "Player",
          };
        });

        // Sort stable so UI doesn’t jump
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPlayers(list);
      },
      () => setError("Failed to listen for lobby players."),
    );

    return () => unsub();
  }, [user, roomCode, gameweek, seasonKey]);

  // 5b) Listen to total room players so start is allowed only when all are in lobby
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "rooms", roomCode, "players"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: LobbyPlayer[] = snap.docs.map((d) => {
          const data = d.data() as RoomPlayerDoc;
          const nick = String(data.nickName || "").trim();
          return {
            uid: d.id,
            displayName: nick || data.displayName || "Player",
          };
        });
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setRoomPlayers(list);
        setRoomPlayersCount(list.length);
      },
      () => {
        setRoomPlayers([]);
        setRoomPlayersCount(0);
      },
    );
    return () => unsub();
  }, [user, roomCode]);

  // 6) Auto-redirect everyone when the leader starts the game
  const routedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (!roomCode) return;
    if (gameweek == null || !seasonKey) return;

    const gameRef = doc(
      db,
      "rooms",
      roomCode.toUpperCase(),
      "seasons",
      seasonKey,
      "games",
      `gw-${gameweek}`,
    );

    const unsub = onSnapshot(
      gameRef,
      (snap) => {
        const raw = (snap.data() as GameStateDoc | undefined)?.state;
        const st = String(raw ?? "")
          .trim()
          .toUpperCase();

        // DEBUG (keep for now)
        console.log("[minigame lobby] state:", raw, "=>", st);

        if (routedRef.current) return;

        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
          return;
        }

        if (st === "GOLDEN") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/golden`);
          return;
        }

        if (st === "REVEAL") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/reveal`);
          return;
        }
      },
      (err) => {
        console.log("[minigame lobby] snapshot error:", err?.message || err);
      },
    );

    return () => unsub();
  }, [user, roomCode, gameweek, router, seasonKey]);

  async function safeLeaveLobby() {
    const ref = lobbyRefRef.current;
    if (ref) {
      await deleteDoc(ref).catch(() => {});
      lobbyRefRef.current = null;
    }
  }

  async function onBack() {
    await safeLeaveLobby();
    router.push(`/room/${roomCode}`);
  }

  async function startMiniGame() {
    if (!user) return;
    if (gameweek == null || !seasonKey) {
      setError("Season/gameweek not loaded yet.");
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw: gameweek,
          leaderUid: user.uid,
          seasonKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to start mini-game.");

      // Leader goes immediately; others will follow via the gameRef listener
      router.push(`/room/${roomCode}/minigame/play`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start mini-game.");
    } finally {
      setStarting(false);
    }
  }

  // Simple loading guard
  if (loading) return null;

  const allPlayersInLobby = roomPlayersCount > 0 && players.length === roomPlayersCount;
  const lobbyUidSet = new Set(players.map((p) => p.uid));
  const missingPlayers = roomPlayers.filter((p) => !lobbyUidSet.has(p.uid));
  const isLocked = lockAtMs != null && nowMs >= lockAtMs;
  const countdownParts = getCountdownParts(
    lockAtMs != null ? lockAtMs - nowMs : 0,
  );
  const msLeft = lockAtMs != null ? Math.max(lockAtMs - nowMs, 0) : 0;
  const totalSec = Math.floor(msLeft / 1000);
  const dayValue = Math.floor(totalSec / 86400);
  const hourValue = Math.floor((totalSec % 86400) / 3600);
  const minuteValue = Math.floor((totalSec % 3600) / 60);
  const secondValue = totalSec % 60;
  const countdownRings = [
    {
      label: "Days",
      value: countdownParts.days,
      progress: dayValue > 0 ? Math.min((dayValue / 7) * 100, 100) : 0,
    },
    {
      label: "Hours",
      value: countdownParts.hours,
      progress: (hourValue / 24) * 100,
    },
    {
      label: "Minutes",
      value: countdownParts.minutes,
      progress: (minuteValue / 60) * 100,
    },
    {
      label: "Seconds",
      value: countdownParts.seconds,
      progress: (secondValue / 60) * 100,
    },
  ];

  return (
    <div className="min-h-[100dvh] p-6 bg-app">
      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Mini-Game Lobby
            </h1>
            <div className="font-display text-sm text-muted">
              {roomCode} {gameweek != null ? `• GW ${gameweek}` : ""}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onBack}
              className="text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
            >
              Back
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <div className="border border-teal-500 rounded-xl p-4 space-y-2 bg-surface-2">
          <div className="font-semibold text-foreground">
            Mini-game Controls
          </div>
          <div className="border border-teal-500 rounded-xl p-3 bg-surface space-y-2">
            <div className="text-sm font-semibold text-foreground">Mini-game Style</div>
            <div className="text-sm text-muted">
              Style:{" "}
              <span className="font-display text-foreground font-semibold">
                {sameResultLockEnabled ? "Round-Robin" : "Sprint"}
              </span>
            </div>
          </div>
          <div className="border border-teal-500 rounded-xl p-3 bg-surface space-y-3">
            <div className="text-sm font-semibold text-foreground">Weekend Lock Countdown</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {countdownRings.map((unit) => (
                <div key={unit.label} className="flex flex-col items-center gap-2">
                  <div className="relative w-16 h-16 sm:w-[72px] sm:h-[72px]">
                    <svg
                      className="absolute inset-0 w-full h-full -rotate-90"
                      viewBox="0 0 80 80"
                      aria-hidden="true"
                    >
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        fill="none"
                        stroke="rgba(45, 212, 191, 0.2)"
                        strokeWidth="4"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        fill="none"
                        stroke="#2dd4bf"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={213.63}
                        strokeDashoffset={
                          213.63 - (Math.max(Math.min(unit.progress, 100), 0) / 100) * 213.63
                        }
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-display text-lg sm:text-xl font-semibold text-foreground leading-none">
                        {unit.value}
                      </span>
                    </div>
                  </div>
                  <div className="font-display text-[11px] uppercase tracking-wide text-accent font-semibold">
                    {unit.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isLeader ? (
            <>
              <button
                className="rounded-lg px-4 py-2 bg-accent text-accent-foreground disabled:opacity-60"
                disabled={
                  starting ||
                  gameweek == null ||
                  players.length < 1 ||
                  !allPlayersInLobby ||
                  isLocked
                }
                onClick={startMiniGame}
              >
                {starting ? "Starting…" : "Start Mini-game"}
              </button>

              {players.length >= 2 && !allPlayersInLobby && (
                <>
                  <div className="text-xs text-muted">
                    Waiting for all room players to join lobby ({players.length}/{roomPlayersCount}).
                  </div>
                  {missingPlayers.length > 0 && (
                    <div className="text-xs text-muted">
                      Missing: {missingPlayers.map((p) => p.displayName).join(", ")}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="text-sm text-muted">
              Waiting for the leader to start once everyone is ready…
            </div>
          )}
        </div>

        <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
          <div className="font-semibold mb-2 text-foreground">
            Room Player Status
          </div>
          <div className="space-y-2">
            {roomPlayersCount === 0 ? (
              <div className="text-sm text-muted">
                No players found in this room yet.
              </div>
            ) : (
              roomPlayers.map((p) => {
                const inLobby = lobbyUidSet.has(p.uid);
                return (
                  <div
                    key={p.uid}
                    className="flex items-center justify-between border-b border-subtle last:border-0 py-2"
                  >
                    <div className="font-display font-medium text-foreground">{p.displayName}</div>
                    <div className="flex items-center gap-2">
                      {p.uid === leaderUid && (
                        <span className="font-display text-xs px-2 py-1 rounded-full bg-surface border border-teal-500 text-muted">
                          Leader
                        </span>
                      )}
                      <span
                        className={[
                          "font-display text-xs px-2 py-1 rounded-full border",
                          inLobby
                            ? "bg-emerald-400/15 border-emerald-400 text-emerald-300"
                            : "bg-amber-400/15 border-amber-400 text-amber-300",
                        ].join(" ")}
                      >
                        {inLobby ? "Ready" : "Waiting"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
