// Minigame Lobby page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Lock } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import AnimatedModal from "../../../../components/AnimatedModal";
import ModalExitButton from "../../../../components/ModalExitButton";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import SectionCard from "../../../../components/SectionCard";
import SpecialBreak from "../../../../components/SpecialBreak";
import StatusPill from "../../../../components/StatusPill";
import TopActionRow from "../../../../components/TopActionRow";
import { db } from "../../../../firebase";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { resolveDisplayName } from "@/lib/displayNameResolver";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { subscribeRoomMeta, subscribeRoomPlayers } from "@/lib/liveGameBus";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getCountdownParts, LOCK_WINDOW_MS } from "./lock-utils";

type LobbyPlayer = { uid: string; displayName: string };
type LobbyDoc = { displayName?: string };
type GameStateDoc = { state?: string };
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
  const [powerupsEnabled, setPowerupsEnabled] = useState<boolean>(false);
  const [modeSettingsOpen, setModeSettingsOpen] = useState(false);
  const [modeGuideOpen, setModeGuideOpen] = useState(false);
  const [modeSettingsBusy, setModeSettingsBusy] = useState(false);
  const [guideOpenMode, setGuideOpenMode] = useState<"round_robin" | "captain" | "sprint" | null>(
    "round_robin",
  );
  const [guideOpenPowerup, setGuideOpenPowerup] = useState<"all_in" | "safety_net" | null>(
    "all_in",
  );
  const [lockAtMs, setLockAtMs] = useState<number | null>(null);
  const [unlockAtMs, setUnlockAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const bootstrapRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 1) Auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
    }
  }, [loading, user, router, roomCode]);

  // 2) Load current gameweek + initial room mode from bootstrap (lobby is tied to GW)
  useEffect(() => {
    let cancelled = false;
    const loadBootstrap = async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        if (cancelled) return;
        const gw = Number(data.currentGameweek ?? 1);
        setGameweek(Number.isFinite(gw) ? gw : 1);
        setSeasonKey(String(data.seasonKey || ""));
        setLeaderUid(data.leaderUid ?? null);
        const style = data.gameModeStyle ?? "sprint";
        setGameModeStyle(style);
        setAllowIdenticalPicks(style === "sprint" ? true : Boolean(data.allowIdenticalPicks));
        setPowerupsEnabled(Boolean(data.powerupsEnabled));
        const st = String(data.gameState || "").trim().toUpperCase();
        if (
          !routedRef.current &&
          (st === "DRAFT" || st === "GOLDEN" || st === "POWERUPS" || st === "REVEAL")
        ) {
          routedRef.current = true;
          if (st === "DRAFT") router.replace(`/room/${roomCode}/minigame/play`);
          else if (st === "GOLDEN") router.replace(`/room/${roomCode}/minigame/golden`);
          else if (st === "POWERUPS") router.replace(`/room/${roomCode}/minigame/powerups`);
          else router.replace(`/room/${roomCode}/minigame/reveal`);
        }
      } catch {
        if (cancelled) return;
        bootstrapRetryRef.current = setTimeout(loadBootstrap, 1500);
      }
    };
    void loadBootstrap();

    return () => {
      cancelled = true;
      if (bootstrapRetryRef.current) {
        clearTimeout(bootstrapRetryRef.current);
        bootstrapRetryRef.current = null;
      }
    };
  }, [roomCode, router]);

  // 2b) Live room meta updates (leader + mode + lock setting)
  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => {
        if (!roomMeta) return;
        setLeaderUid(roomMeta.leaderUid);
        const style = roomMeta.settings.gameModeStyle;
        setGameModeStyle(style);
        setAllowIdenticalPicks(style === "sprint" ? true : !roomMeta.settings.sameResultLock);
        setPowerupsEnabled(roomMeta.settings.powerupsEnabled === true);
      },
      () => {},
    );
  }, [roomCode]);

  // 3) Resolve best display name for lobby presence writes.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      const dn = await resolveDisplayName({
        uid: user.uid,
        email: user.email,
        roomCode,
      });
      if (!cancelled) setMyDisplayName(dn);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, roomCode]);

  useEffect(() => {
    if (gameweek == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const data = await getFixturesCached(gameweek, seasonKey);
      const fixtures: Fixture[] = Array.isArray(data?.fixtures) ? data.fixtures : [];

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
          unlock.setUTCDate(unlock.getUTCDate() + 1);
          unlock.setUTCHours(0, 1, 0, 0);
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
        list.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
        );
        setPlayers(list);
      },
      () => setError("Failed to listen for lobby players."),
    );

    return () => unsub();
  }, [user, roomCode, gameweek, seasonKey]);

  // 5b) Listen to total room players so start is allowed only when all are in lobby
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cancelled || !cached.length) return;
        const seeded: LobbyPlayer[] = cached
          .map((p) => ({
            uid: p.uid,
            displayName: String(p.nickName || "").trim() || p.displayName || "Player",
          }))
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
          );
        setRoomPlayers(seeded);
        setRoomPlayersCount(seeded.length);
      } catch {
        // ignore cache seed errors
      }
    })();
    const unsub = subscribeRoomPlayers(
      roomCode,
      (players) => {
        const list: LobbyPlayer[] = players.map((player) => {
          const nick = String(player.nickName || "").trim();
          return {
            uid: player.uid,
            displayName: nick || player.displayName || "Player",
          };
        });
        list.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
        );
        setRoomPlayers(list);
        setRoomPlayersCount(list.length);
      },
      () => {
        setError("Failed to load room players.");
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
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

        if (st === "POWERUPS") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/powerups`);
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
      setAllowIdenticalPicks(!storedSameResultLock);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update lock.");
    } finally {
      setModeSettingsBusy(false);
    }
  }

  async function togglePowerupsEnabled() {
    if (!user || !isLeader || modeSettingsBusy) return;
    const nextEnabled = !powerupsEnabled;
    setModeSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          powerupsEnabled: nextEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update power-ups.");
      setPowerupsEnabled(data?.powerupsEnabled === true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update power-ups.");
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
            Control Panel
          </div>
          {!isLocked && (
            <div className="border border-teal-500 rounded-xl p-3 bg-surface space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">Game Style</div>
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
              <div className="text-xs text-muted">
                Power-Ups:{" "}
                <span className="font-display text-foreground">
                  {powerupsEnabled ? "ON" : "OFF"}
                </span>
              </div>
            </div>
          )}
          <div className="border border-teal-500 rounded-xl p-3 bg-surface space-y-3">
            {isLocked ? (
              <>
                <div className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
                  <Lock size={16} className="animate-pulse text-foreground" aria-hidden="true" />
                  <span className="font-display">GW{gameweek ?? "—"} Locked</span>
                  <Lock size={16} className="animate-pulse text-foreground" aria-hidden="true" />
                </div>
                <SpecialBreak />
                <div className="text-sm text-muted text-center">
                  Next gameweek:{" "}
                  <span className="font-display text-foreground">
                    GW {gameweek != null ? gameweek + 1 : "—"}
                  </span>
                </div>
                {unlockAtMs != null && (
                  <>
                    <div className="text-sm text-muted text-center">
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
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: "Days", value: unlockCountdown.days, progress: Math.min((Math.floor(unlockMsLeft / 1000 / 86400) / 7) * 100, 100) },
                        { label: "Hours", value: unlockCountdown.hours, progress: (Math.floor((unlockMsLeft / 1000 % 86400) / 3600) / 24) * 100 },
                        { label: "Minutes", value: unlockCountdown.minutes, progress: (Math.floor((unlockMsLeft / 1000 % 3600) / 60) / 60) * 100 },
                        { label: "Seconds", value: unlockCountdown.seconds, progress: (Math.floor(unlockMsLeft / 1000) % 60 / 60) * 100 },
                      ].map((unit) => (
                        <div key={`locked-${unit.label}`} className="flex flex-col items-center gap-2">
                          <div className="relative w-16 h-16 sm:w-[72px] sm:h-[72px]">
                            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
                              <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(var(--room-accent-rgb), 0.2)" strokeWidth="4" />
                              <circle
                                cx="40"
                                cy="40"
                                r="34"
                                fill="none"
                                stroke="rgb(var(--room-accent-rgb))"
                                strokeWidth="4"
                                strokeLinecap="round"
                                strokeDasharray={213.63}
                                strokeDashoffset={213.63 - (Math.max(Math.min(unit.progress, 100), 0) / 100) * 213.63}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="font-display text-lg sm:text-xl font-semibold text-foreground leading-none">{unit.value}</span>
                            </div>
                          </div>
                          <div className="font-display text-[11px] uppercase tracking-wide text-accent font-semibold">{unit.label}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          {isLeader && !isLocked ? (
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
            </>
          ) : isLocked ? (
            <div className="text-sm text-muted text-center">Missed deadline for this gameweek.</div>
          ) : (
            <div className="text-sm text-muted inline-flex items-center justify-center gap-2 w-full">
              <Loader2 size={14} className="animate-spin" />
              <span>Waiting for the leader to start once everyone is ready…</span>
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
                      <StatusPill
                        label={isLocked ? "Missed" : inLobby ? "Ready" : "Waiting"}
                        tone={isLocked ? "waiting" : inLobby ? "ready" : "waiting"}
                      />
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
        zIndexClassName="z-[90]"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-lg h-[min(86vh,720px)] rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface p-4 overflow-hidden"
      >
        <div className="h-full flex flex-col min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <div className="font-display text-lg font-semibold text-foreground">Game Guide</div>
            <ModalExitButton
              onClick={() => setModeGuideOpen(false)}
              ariaLabel="Exit game guide"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto no-scrollbar space-y-4 pr-1 mt-4">
            <div className="rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-1">
              <div className="text-xs text-muted">Current Setup</div>
              <div className="font-display font-semibold text-foreground">
                {modeLabel} • Allow Identical Picks {allowIdenticalPicks ? "ON" : "OFF"}
              </div>
              <div className="text-xs text-muted">
                Power-Ups: {powerupsEnabled ? "ON" : "OFF"}
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
            <div className="space-y-2">
              <div className="text-xs text-muted uppercase tracking-wide">Modes</div>
              {[
                {
                  key: "round_robin" as const,
                  title: "Round-Robin",
                  body:
                    "Traditional turn-by-turn mode. Players rotate through fixtures in order. Allow Identical Picks ON allows duplicate picks (hidden until reveal); OFF enforces unique picks.",
                },
                {
                  key: "captain" as const,
                  title: "Captain",
                  body:
                    "Captain rotates each fixture and chooses which fixture is played next. Allow Identical Picks ON runs parallel submissions hidden until reveal; OFF runs turn-based picks.",
                },
                {
                  key: "sprint" as const,
                  title: "Sprint",
                  body:
                    "Fastest mode. Everyone submits together each fixture and picks stay hidden until reveal.",
                },
              ].map((item) => {
                const open = guideOpenMode === item.key;
                return (
                  <div key={item.key} className="rounded-lg border border-subtle bg-surface-2">
                    <button
                      type="button"
                      onClick={() => setGuideOpenMode((prev) => (prev === item.key ? null : item.key))}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="font-display font-semibold text-foreground">{item.title}</span>
                      <ChevronDown
                        size={14}
                        className={`text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                    <div
                      className={[
                        "grid transition-all duration-200 ease-out overflow-hidden",
                        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                      ].join(" ")}
                    >
                      <div className="min-h-0 px-3 pb-3 text-sm text-muted">{item.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted uppercase tracking-wide">Power-Ups (Optional)</div>
              {[
                {
                  key: "all_in" as const,
                  title: "All-In",
                  body: "Exact score = 6 points, otherwise 0.",
                },
                {
                  key: "safety_net" as const,
                  title: "Safety Net",
                  body: "If your fixture points are 0, they become 1.",
                },
              ].map((item) => {
                const open = guideOpenPowerup === item.key;
                return (
                  <div key={item.key} className="rounded-lg border border-subtle bg-surface-2">
                    <button
                      type="button"
                      onClick={() => setGuideOpenPowerup((prev) => (prev === item.key ? null : item.key))}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="font-display font-semibold text-foreground">{item.title}</span>
                      <ChevronDown
                        size={14}
                        className={`text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                    <div
                      className={[
                        "grid transition-all duration-200 ease-out overflow-hidden",
                        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                      ].join(" ")}
                    >
                      <div className="min-h-0 px-3 pb-3 text-sm text-muted">{item.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </AnimatedModal>
      <AnimatedModal
        open={modeSettingsOpen && isLeader}
        onClose={() => setModeSettingsOpen(false)}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-md rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface p-4 space-y-4"
      >
            <div className="flex items-center justify-between">
              <div className="font-display text-lg font-semibold text-foreground">Game Mode</div>
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
            <button
              onClick={togglePowerupsEnabled}
              disabled={modeSettingsBusy}
              className="w-full text-sm rounded-lg px-4 py-2 border bg-surface border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
            >
              {modeSettingsBusy
                ? "Saving..."
                : powerupsEnabled
                  ? "Power-Ups: ON"
                  : "Power-Ups: OFF"}
            </button>
      </AnimatedModal>
    </>
  );
}
