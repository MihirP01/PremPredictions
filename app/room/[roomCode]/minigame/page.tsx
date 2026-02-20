// Minigame Lobby page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import AnimatedModal from "../../../../components/AnimatedModal";
import ModalExitButton from "../../../../components/ModalExitButton";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import SectionCard from "../../../../components/SectionCard";
import StatusPill from "../../../../components/StatusPill";
import TopActionRow from "../../../../components/TopActionRow";
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
import { getCountdownParts, LOCK_WINDOW_MS } from "./lock-utils";

type LobbyPlayer = { uid: string; displayName: string };
type RoomPlayerDoc = { displayName?: string; nickName?: string };
type UserDoc = { displayName?: string; nickName?: string };
type LobbyDoc = { displayName?: string };
type GameStateDoc = { state?: string };
type RoomDoc = {
  leaderUid?: string;
  settings?: {
    sameResultLock?: boolean;
    gameModeStyle?: "round_robin" | "sprint" | "captain";
  };
};
type Fixture = { kickoff?: string };

function formatUnlockDateParts(ms: number) {
  const dt = new Date(ms);
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
  const time = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { day, suffix, monthYear, time };
}

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
  const [gameModeStyle, setGameModeStyle] = useState<"round_robin" | "sprint" | "captain">(
    "round_robin",
  );
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState<boolean>(true);
  const [modeSettingsOpen, setModeSettingsOpen] = useState(false);
  const [modeGuideOpen, setModeGuideOpen] = useState(false);
  const [modeSettingsBusy, setModeSettingsBusy] = useState(false);
  const [lockAtMs, setLockAtMs] = useState<number | null>(null);
  const [unlockAtMs, setUnlockAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const isLeader = !!user && leaderUid === user.uid;
  const modeLabel =
    gameModeStyle === "round_robin"
      ? "Round-Robin"
      : gameModeStyle === "captain"
        ? "Captain"
        : "Sprint";
  const currentModeSummary =
    gameModeStyle === "sprint"
      ? "Everyone submits at once each fixture. Fastest flow for larger rooms."
      : gameModeStyle === "captain"
        ? allowIdenticalPicks
          ? "Captain picks the fixture order, then everyone submits together."
          : "Captain picks the fixture order, then players submit one-by-one."
        : allowIdenticalPicks
          ? "Classic turn flow with duplicate score picks allowed."
          : "Classic turn flow with unique score picks per fixture.";

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
        const sameResultLock = roomData?.settings?.sameResultLock !== false;
        setGameModeStyle(
          roomData?.settings?.gameModeStyle ??
            (sameResultLock ? "round_robin" : "sprint"),
        );
        setAllowIdenticalPicks(
          (roomData?.settings?.gameModeStyle ?? (sameResultLock ? "round_robin" : "sprint")) ===
            "sprint"
            ? true
            : !sameResultLock,
        );
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
      const kickoffTimes = fixtures
        .map((f) => Date.parse(String(f.kickoff || "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      const lastKickoff = kickoffTimes.length ? kickoffTimes[kickoffTimes.length - 1] : null;

      if (!cancelled) {
        setLockAtMs(
          Number.isFinite(firstKickoff) ? firstKickoff - LOCK_WINDOW_MS : null,
        );
        if (Number.isFinite(lastKickoff ?? NaN)) {
          const unlock = new Date(lastKickoff as number);
          unlock.setDate(unlock.getDate() + 1);
          unlock.setHours(9, 0, 0, 0);
          setUnlockAtMs(unlock.getTime());
        } else {
          setUnlockAtMs(null);
        }
      }
    })().catch(() => {
      if (!cancelled) {
        setLockAtMs(null);
        setUnlockAtMs(null);
      }
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
    if (roomPlayers.length < 2) {
      setError("Need at least 2 players to play the mini-game.");
      return;
    }
    if (lockAtMs != null && nowMs >= lockAtMs) {
      setError("Deadline missed for this gameweek. Mini-game is locked.");
      return;
    }
    const lobbyUidSet = new Set(players.map((p) => p.uid));
    const everyoneReady =
      roomPlayers.length > 0 &&
      roomPlayers.every((p) => lobbyUidSet.has(p.uid)) &&
      players.length === roomPlayers.length;
    if (!everyoneReady) {
      setError(
        `All room players must be Ready before starting (${players.length}/${roomPlayers.length}).`,
      );
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

  async function updateGameModeStyle(nextStyle: "round_robin" | "sprint" | "captain") {
    if (!user || !isLeader || modeSettingsBusy) return;
    setModeSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          gameModeStyle: nextStyle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update mode.");
      setGameModeStyle(nextStyle);
      setAllowIdenticalPicks(nextStyle === "sprint" ? true : !(data?.sameResultLock !== false));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update mode.");
    } finally {
      setModeSettingsBusy(false);
    }
  }

  async function toggleSameResultLock() {
    if (!user || !isLeader || modeSettingsBusy) return;
    if (gameModeStyle === "sprint") return;
    const nextAllowIdentical = !allowIdenticalPicks;
    setModeSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          // server flag keeps legacy meaning: true => duplicates blocked
          sameResultLock: !nextAllowIdentical,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update lock.");
      const storedSameResultLock = data?.sameResultLock !== false;
      setAllowIdenticalPicks(gameModeStyle === "sprint" ? true : !storedSameResultLock);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update lock.");
    } finally {
      setModeSettingsBusy(false);
    }
  }

  // Simple loading guard
  if (loading) return null;

  const lobbyUidSet = new Set(players.map((p) => p.uid));
  const allPlayersReady =
    roomPlayersCount > 0 &&
    roomPlayers.every((p) => lobbyUidSet.has(p.uid)) &&
    players.length === roomPlayersCount;
  const isLocked = lockAtMs != null && nowMs >= lockAtMs;
  const unlockMsLeft = unlockAtMs != null ? Math.max(unlockAtMs - nowMs, 0) : 0;
  const unlockCountdown = getCountdownParts(unlockMsLeft);
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
    <>
      <PageShell innerClassName="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <TopActionRow
          title="Mini-Game Lobby"
          subtitle={`${roomCode}${gameweek != null ? ` • GW ${gameweek}` : ""}`}
          actions={<PageBackButton onClick={onBack} />}
        />

        {error && <div className="text-sm text-danger">{error}</div>}

        <SectionCard className="border border-teal-500 rounded-xl p-4 space-y-2 bg-surface-2">
          <div className="font-semibold text-foreground">
            Mini-game Controls
          </div>
          <div className="border border-teal-500 rounded-xl p-3 bg-surface space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">Mini-game Style</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModeGuideOpen(true)}
                  className="text-xs rounded-lg px-3 py-1.5 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
                >
                  Guide
                </button>
                {isLeader && (
                  <button
                    onClick={() => setModeSettingsOpen(true)}
                    className="text-xs rounded-lg px-3 py-1.5 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
                  >
                    Mode
                  </button>
                )}
              </div>
            </div>
            <div className="text-sm text-muted">
              Style:{" "}
              <span className="font-display text-foreground font-semibold">
                {modeLabel}
              </span>
            </div>
            <div className="text-xs text-muted">
              Allow Identical Picks:{" "}
              <span className="font-display text-foreground">
                {allowIdenticalPicks ? "ON" : "OFF"}
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
                        stroke="rgba(var(--room-accent-rgb), 0.2)"
                        strokeWidth="4"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        fill="none"
                        stroke="rgb(var(--room-accent-rgb))"
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
                  roomPlayersCount < 2 ||
                  !allPlayersReady ||
                  isLocked
                }
                onClick={startMiniGame}
              >
                {starting ? "Starting…" : "Start Mini-game"}
              </button>

              {roomPlayersCount < 2 && (
                <div className="text-xs text-muted">
                  Need at least 2 players to play the mini-game.
                </div>
              )}
              {isLocked && (
                <div className="text-xs text-muted space-y-1">
                  <div>Deadline missed for this GW. Mini-game is locked.</div>
                  <div>
                    Next gameweek:{" "}
                    <span className="font-display text-foreground">
                      GW {gw != null ? gw + 1 : "—"}
                    </span>
                  </div>
                  {unlockAtMs != null && (
                    <>
                      <div>
                        Next gameweek unlock:{" "}
                        <span className="font-display text-foreground">
                          {(() => {
                            const p = formatUnlockDateParts(unlockAtMs);
                            return (
                              <>
                                {p.day}
                                <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                                  {p.suffix}
                                </span>{" "}
                                {p.monthYear} {p.time}
                              </>
                            );
                          })()}
                        </span>
                      </div>
                      <div className="font-display text-foreground">
                        [{unlockCountdown.days}d] [{unlockCountdown.hours}h] [{unlockCountdown.minutes}m] [{unlockCountdown.seconds}s]
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted">
              Waiting for the leader to start once everyone is ready…
            </div>
          )}
        </SectionCard>

        <SectionCard>
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
                        <StatusPill label="Leader" tone="neutral" />
                      )}
                      <StatusPill label={inLobby ? "Ready" : "Waiting"} tone={inLobby ? "ready" : "waiting"} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>
      </PageShell>
      <AnimatedModal
        open={modeGuideOpen}
        onClose={() => setModeGuideOpen(false)}
        portal
        lockBackground
        zIndexClassName="z-50"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-lg rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface p-4 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-foreground">Mini-game Guide</div>
          <ModalExitButton
            onClick={() => setModeGuideOpen(false)}
            ariaLabel="Exit game guide"
          />
        </div>
        <div className="rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-1">
          <div className="text-xs text-muted">Current Setup</div>
          <div className="font-display font-semibold text-foreground">
            {modeLabel} • Allow Identical Picks {allowIdenticalPicks ? "ON" : "OFF"}
          </div>
          <div className="text-sm text-muted">{currentModeSummary}</div>
          {allowIdenticalPicks && (
            <div className="text-xs text-muted">ON = Hidden until reveal, same picks allowed.</div>
          )}
        </div>
        <div className="w-full flex items-center justify-center gap-1.5">
          <span className="h-px w-8 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.05)_0%,rgba(var(--room-accent-rgb),0.42)_100%)]" />
          <span
            className="h-1.5 w-1.5 rounded-full border border-[color:rgba(var(--room-accent-rgb),0.75)] bg-[color:rgba(var(--room-accent-rgb),0.55)]"
            aria-hidden
          />
          <span className="h-px w-8 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.42)_0%,rgba(var(--room-accent-rgb),0.05)_100%)]" />
        </div>
        <div className="grid gap-2">
          <div className="rounded-lg border border-subtle bg-surface-2 p-3">
            <div className="font-display font-semibold text-foreground">Round-Robin</div>
            <div className="text-sm text-muted">
              Traditional turn-by-turn mode. Players rotate through fixtures in order.
              ON allows duplicate picks (hidden until reveal); OFF enforces unique picks per fixture.
            </div>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-2 p-3">
            <div className="font-display font-semibold text-foreground">Captain</div>
            <div className="text-sm text-muted">
              The captain rotates each round and selects which fixture to play next.
              ON lets everyone submit together (hidden until reveal); OFF uses turn-based unique picks.
            </div>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-2 p-3">
            <div className="font-display font-semibold text-foreground">Sprint</div>
            <div className="text-sm text-muted">
              Fastest mode. Everyone submits at the same time for each fixture.
              Picks stay hidden until reveal.
            </div>
          </div>
        </div>
      </AnimatedModal>
      <AnimatedModal
        open={modeSettingsOpen && isLeader}
        onClose={() => setModeSettingsOpen(false)}
        portal
        lockBackground
        zIndexClassName="z-50"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-md rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface p-4 space-y-4"
      >
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-foreground">Mini-game Mode</div>
              <ModalExitButton
                onClick={() => setModeSettingsOpen(false)}
                ariaLabel="Exit mode settings"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => updateGameModeStyle("round_robin")}
                disabled={modeSettingsBusy}
                className={[
                  "text-sm rounded-lg px-3 py-2 border disabled:opacity-60",
                  gameModeStyle === "round_robin"
                    ? "bg-[color:rgba(var(--room-accent-rgb),0.16)] border-[color:rgba(var(--room-accent-rgb),0.72)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.28)]"
                    : "bg-surface border-subtle text-foreground hover:bg-surface-2",
                ].join(" ")}
              >
                Round-Robin
              </button>
              <button
                onClick={() => updateGameModeStyle("captain")}
                disabled={modeSettingsBusy}
                className={[
                  "text-sm rounded-lg px-3 py-2 border disabled:opacity-60",
                  gameModeStyle === "captain"
                    ? "bg-[color:rgba(var(--room-accent-rgb),0.16)] border-[color:rgba(var(--room-accent-rgb),0.72)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.28)]"
                    : "bg-surface border-subtle text-foreground hover:bg-surface-2",
                ].join(" ")}
              >
                Captain
              </button>
              <button
                onClick={() => updateGameModeStyle("sprint")}
                disabled={modeSettingsBusy}
                className={[
                  "text-sm rounded-lg px-3 py-2 border disabled:opacity-60",
                  gameModeStyle === "sprint"
                    ? "bg-[color:rgba(var(--room-accent-rgb),0.16)] border-[color:rgba(var(--room-accent-rgb),0.72)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.28)]"
                    : "bg-surface border-subtle text-foreground hover:bg-surface-2",
                ].join(" ")}
              >
                Sprint
              </button>
            </div>
            <button
              onClick={toggleSameResultLock}
              disabled={modeSettingsBusy || gameModeStyle === "sprint"}
              className={[
                "w-full text-sm rounded-lg px-4 py-2 border disabled:opacity-60",
                gameModeStyle === "sprint"
                  ? "bg-surface-2 border-subtle text-muted cursor-not-allowed"
                  : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
              ].join(" ")}
            >
              {modeSettingsBusy
                ? "Saving..."
                : gameModeStyle === "sprint"
                  ? "Allow Identical Picks: ON (Sprint)"
                  : allowIdenticalPicks
                    ? "Allow Identical Picks: ON"
                    : "Allow Identical Picks: OFF"}
            </button>
      </AnimatedModal>
    </>
  );
}
