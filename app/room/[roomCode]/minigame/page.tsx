// Minigame Lobby page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Lock } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import PageBackButton from "../../../../components/PageBackButton";
import PageShell from "../../../../components/PageShell";
import { ModalHeader, ThemedModal } from "../../../../components/RoomModal";
import SectionCard from "../../../../components/SectionCard";
import SpecialBreak from "../../../../components/SpecialBreak";
import StatusPill from "../../../../components/StatusPill";
import TopActionRow from "../../../../components/TopActionRow";
import { db } from "../../../../firebase";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { resolveDisplayName } from "@/lib/displayNameResolver";
import { getFixturesCached, refreshFixturesCached } from "@/lib/fixturesClient";
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
type Fixture = { kickoff?: string; status?: string };

const ESTIMATED_FULL_TIME_MS = 150 * 60 * 1000;

function isFinalFixtureStatus(status?: string) {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "FINISHED" || normalized === "FT" || normalized === "AWARDED";
}

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

function LobbyStatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.012))] p-4">
      <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/48">
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</div>
      {note ? <div className="mt-2 text-xs text-muted">{note}</div> : null}
    </div>
  );
}

function CountdownRing({
  label,
  value,
  progress,
}: {
  label: string;
  value: string;
  progress: number;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[20px] border border-white/8 bg-white/[0.02] p-3">
      <div className="relative h-16 w-16 sm:h-[72px] sm:w-[72px]">
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
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
            strokeDashoffset={213.63 - (Math.max(Math.min(progress, 100), 0) / 100) * 213.63}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-semibold text-foreground sm:text-xl">{value}</span>
        </div>
      </div>
      <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/56">
        {label}
      </div>
    </div>
  );
}

function GuideDisclosure({
  title,
  body,
  open,
  onToggle,
}: {
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="font-display text-sm font-semibold text-foreground">{title}</div>
        <ChevronDown
          size={14}
          className={`text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={[
          "grid overflow-hidden transition-all duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        ].join(" ")}
      >
        <div className="min-h-0 px-4 pb-4 text-sm text-muted">{body}</div>
      </div>
    </div>
  );
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
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const syncFixturesWindow = async (force = false) => {
      const data = force
        ? await refreshFixturesCached(gameweek, seasonKey)
        : await getFixturesCached(gameweek, seasonKey);
      const fixtures: Fixture[] = Array.isArray(data?.fixtures) ? data.fixtures : [];
      const kickoffTimes = fixtures
        .map((f) => Date.parse(String(f.kickoff || "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      const firstKickoff = kickoffTimes[0];
      const pendingKickoffs = fixtures
        .filter((f) => !isFinalFixtureStatus(f.status))
        .map((f) => Date.parse(String(f.kickoff || "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      const lastPendingKickoff = pendingKickoffs.length
        ? pendingKickoffs[pendingKickoffs.length - 1]
        : null;
      const allFinished = fixtures.length > 0 && pendingKickoffs.length === 0;

      if (cancelled) return;

      setLockAtMs(Number.isFinite(firstKickoff) ? firstKickoff - LOCK_WINDOW_MS : null);

      if (allFinished) {
        setUnlockAtMs(Date.now());
        setGameweek((prev) => (prev == null ? prev : Math.min(prev + 1, 38)));
        return;
      }

      if (Number.isFinite(lastPendingKickoff ?? NaN)) {
        setUnlockAtMs((lastPendingKickoff as number) + ESTIMATED_FULL_TIME_MS);
      } else {
        setUnlockAtMs(null);
      }

      const shouldPoll =
        Number.isFinite(firstKickoff) && Date.now() >= (firstKickoff as number) - LOCK_WINDOW_MS;
      if (shouldPoll) {
        refreshTimer = setTimeout(() => {
          void syncFixturesWindow(true).catch(() => {});
        }, 10_000);
      }
    };

    void syncFixturesWindow(false).catch(() => {
      if (!cancelled) {
        setLockAtMs(null);
        setUnlockAtMs(null);
      }
    });

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
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
  const readyCount = players.length;
  const missingCount = Math.max(roomPlayersCount - readyCount, 0);

  return (
    <>
      <PageShell width="standard">
        <TopActionRow
          title="Predictions Lobby"
          subtitle={`${roomCode}${gameweek != null ? ` • GW ${gameweek}` : ""}`}
          actions={<PageBackButton onClick={onBack} />}
        />

        {error ? (
          <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-1">
            <div className="rounded-[24px] border border-white/6 bg-[radial-gradient(circle_at_top_right,rgba(var(--room-accent-rgb),0.1),transparent_38%),linear-gradient(180deg,rgba(5,10,22,0.92),rgba(7,10,18,0.88))] px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/42">
                      Predictions desk
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/72">
                        Gameweek
                      </span>
                      <span className="font-display text-[1.35rem] font-semibold text-foreground sm:text-[1.65rem]">
                        GW {gameweek ?? "—"} Predictions
                      </span>
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-2 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <div className="text-[0.62rem] uppercase tracking-[0.18em] text-white/38">
                      Gameweek status
                    </div>
                    <div className="font-display text-lg font-semibold text-foreground">
                      {isLocked ? "Missed" : allPlayersReady ? "Open" : `${missingCount} missing`}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
                  <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-white/42">
                    Control centre
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => setModeGuideOpen(true)}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-medium text-foreground transition hover:bg-white/[0.05]"
                    >
                      Guide
                    </button>
                    {isLeader ? (
                      <button
                        onClick={() => setModeSettingsOpen(true)}
                        className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-medium text-foreground transition hover:bg-white/[0.05]"
                      >
                        Mode
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <LobbyStatTile label="Style" value={modeLabel} note="Current room format" />
                  <LobbyStatTile
                    label="Identical Picks"
                    value={allowIdenticalPicks ? "ON" : "OFF"}
                    note={allowIdenticalPicks ? "Parallel-friendly picks." : "Unique picks enforced."}
                  />
                  <LobbyStatTile
                    label="Power-Ups"
                    value={powerupsEnabled ? "ON" : "OFF"}
                    note={powerupsEnabled ? "Extra chip round enabled." : "Standard scoring only."}
                  />
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.02] p-4">
                  <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                    Lobby readout
                  </div>
                  <div className="mt-2 text-sm text-muted">{currentModeSummary}</div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4 sm:p-5">
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Lock window
            </div>
            <div className="mt-1 font-display text-xl font-semibold text-foreground">
              {isLocked ? `GW${gameweek ?? "—"} locked` : "Weekend countdown"}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(isLocked
                ? [
                    {
                      label: "Days",
                      value: unlockCountdown.days,
                      progress: Math.min((Math.floor(unlockMsLeft / 1000 / 86400) / 7) * 100, 100),
                    },
                    {
                      label: "Hours",
                      value: unlockCountdown.hours,
                      progress: (Math.floor((unlockMsLeft / 1000) % 86400 / 3600) / 24) * 100,
                    },
                    {
                      label: "Minutes",
                      value: unlockCountdown.minutes,
                      progress: (Math.floor((unlockMsLeft / 1000) % 3600 / 60) / 60) * 100,
                    },
                    {
                      label: "Seconds",
                      value: unlockCountdown.seconds,
                      progress: ((Math.floor(unlockMsLeft / 1000) % 60) / 60) * 100,
                    },
                  ]
                : countdownRings
              ).map((unit) => (
                <CountdownRing
                  key={`${isLocked ? "unlock" : "lock"}-${unit.label}`}
                  label={unit.label}
                  value={unit.value}
                  progress={unit.progress}
                />
              ))}
            </div>
            <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.02] p-4 text-sm text-muted">
              {isLocked ? (
                <div className="space-y-2 text-center">
                  <div>
                    Next gameweek:{" "}
                    <span className="font-display font-semibold text-foreground">GW {gameweek != null ? gameweek + 1 : "—"}</span>
                  </div>
                  {unlockAtMs != null ? (
                    <div className="font-display text-foreground">
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
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  Lock closes automatically when the gameweek cutoff hits. Everyone must be ready before the leader can launch the round.
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <SectionCard className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4 sm:p-5">
            <div>
              <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                Ready board
              </div>
              <div className="mt-1 font-display text-xl font-semibold text-foreground">Room player status</div>
              <div className="mt-4 space-y-2">
            {roomPlayersCount === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-muted">
                No players found in this room yet.
              </div>
            ) : (
              roomPlayers.map((p) => {
                const inLobby = lobbyUidSet.has(p.uid);
                return (
                  <div
                    key={p.uid}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3"
                  >
                        <div className="min-w-0">
                          <div className="font-display font-medium text-foreground">{p.displayName}</div>
                          <div className="mt-1 text-xs text-muted">
                            {p.uid === user?.uid ? "You" : p.uid === leaderUid ? "Room leader" : "Room player"}
                          </div>
                        </div>
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
            </div>
          </SectionCard>

          <SectionCard className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4 sm:p-5">
            <div className="space-y-4">
              <div className="rounded-[22px] border border-white/8 bg-white/[0.02] p-4">
                <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                  Launch gate
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-foreground">Start conditions</div>
                <div className="mt-3 space-y-3 text-sm text-muted">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <span>Lobby readiness</span>
                    <span className="font-display font-semibold text-foreground">{allPlayersReady ? "Ready" : "Pending"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <span>Deadline</span>
                    <span className="font-display font-semibold text-foreground">{isLocked ? "Missed" : "Open"}</span>
                  </div>
                </div>
              </div>

              {isLeader && !isLocked ? (
                <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4">
                  <button
                    className="w-full rounded-2xl border border-white/8 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(56,189,248,0.12))] px-4 py-3 font-display text-sm font-semibold text-foreground transition hover:bg-[linear-gradient(135deg,rgba(245,158,11,0.2),rgba(56,189,248,0.14))] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={
                      starting ||
                      gameweek == null ||
                      !allPlayersReady ||
                      isLocked
                    }
                    onClick={startMiniGame}
                  >
                    {starting ? "Starting…" : "Start Mini-game"}
                  </button>
                  <div className="mt-3 text-xs text-muted">
                    {allPlayersReady
                      ? "All conditions are met. Launch when ready."
                      : "Launch remains locked until every room player is marked Ready."}
                  </div>
                </div>
              ) : isLocked ? (
                <div className="rounded-[22px] border border-amber-300/20 bg-amber-400/5 px-4 py-4 text-sm text-amber-100/85">
                  Missed deadline for this gameweek.
                </div>
              ) : (
                <div className="rounded-[22px] border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-muted inline-flex w-full items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Waiting for the leader to start once everyone is ready…</span>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </PageShell>
      <ThemedModal
        open={modeGuideOpen}
        onClose={() => setModeGuideOpen(false)}
        maxWidthClassName="max-w-2xl"
        panelClassName="p-4 sm:p-5"
      >
        <ModalHeader title="Game Guide" onClose={() => setModeGuideOpen(false)} />
        <SectionCard className="rounded-[22px] border border-white/8 bg-[linear-gradient(145deg,rgba(245,158,11,0.06),rgba(255,255,255,0.025)_38%,rgba(56,189,248,0.045)_100%)] p-4">
          <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
            Current setup
          </div>
          <div className="mt-2 font-display text-xl font-semibold text-foreground">
            {modeLabel} • Allow Identical Picks {allowIdenticalPicks ? "ON" : "OFF"}
          </div>
          <div className="mt-2 text-xs text-muted">Power-Ups: {powerupsEnabled ? "ON" : "OFF"}</div>
          <div className="mt-3 text-sm text-muted">{currentModeSummary}</div>
        </SectionCard>
        <SpecialBreak />
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Modes
            </div>
            {[
              {
                key: "round_robin" as const,
                title: "Round-Robin",
                body:
                  "Traditional turn-by-turn mode. Players rotate through fixtures in order. Allow Identical Picks ON allows duplicate picks hidden until reveal; OFF enforces unique picks.",
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
            ].map((item) => (
              <GuideDisclosure
                key={item.key}
                title={item.title}
                body={item.body}
                open={guideOpenMode === item.key}
                onToggle={() => setGuideOpenMode((prev) => (prev === item.key ? null : item.key))}
              />
            ))}
          </div>
          <div className="space-y-2">
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Power-Ups
            </div>
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
            ].map((item) => (
              <GuideDisclosure
                key={item.key}
                title={item.title}
                body={item.body}
                open={guideOpenPowerup === item.key}
                onToggle={() =>
                  setGuideOpenPowerup((prev) => (prev === item.key ? null : item.key))
                }
              />
            ))}
          </div>
        </div>
      </ThemedModal>
      <ThemedModal
        open={modeSettingsOpen && isLeader}
        onClose={() => setModeSettingsOpen(false)}
        maxWidthClassName="max-w-xl"
        panelClassName="p-4 sm:p-5"
      >
        <ModalHeader title="Game Mode" onClose={() => setModeSettingsOpen(false)} />
        <SectionCard className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4">
          <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
            Format selection
          </div>
          <div className="mt-1 text-sm text-muted">Pick the mode that defines turn order and pace for this room.</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([
              ["round_robin", "Round-Robin"],
              ["captain", "Captain"],
              ["sprint", "Sprint"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => updateGameModeStyle(value)}
                disabled={modeSettingsBusy}
                className={[
                  "rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:opacity-60",
                  gameModeStyle === value
                    ? "border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(56,189,248,0.12))] text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    : "border-white/8 bg-white/[0.025] text-foreground hover:bg-white/[0.04]",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionCard>
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4">
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Scoring rules
            </div>
            <div className="mt-1 text-sm text-muted">Identical picks can be locked per round except in Sprint.</div>
            <button
              onClick={toggleSameResultLock}
              disabled={modeSettingsBusy || gameModeStyle === "sprint"}
              className={[
                "mt-4 w-full rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:opacity-60",
                gameModeStyle === "sprint"
                  ? "cursor-not-allowed border-white/8 bg-white/[0.02] text-muted"
                  : "border-white/8 bg-white/[0.03] text-foreground hover:bg-white/[0.05]",
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
          </SectionCard>
          <SectionCard className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] p-4">
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Power-Up deck
            </div>
            <div className="mt-1 text-sm text-muted">Enable or disable the extra chip round for this lobby.</div>
            <button
              onClick={togglePowerupsEnabled}
              disabled={modeSettingsBusy}
              className="mt-4 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-foreground transition hover:bg-white/[0.05] disabled:opacity-60"
            >
              {modeSettingsBusy
                ? "Saving..."
                : powerupsEnabled
                  ? "Power-Ups: ON"
                  : "Power-Ups: OFF"}
            </button>
          </SectionCard>
        </div>
      </ThemedModal>
    </>
  );
}
