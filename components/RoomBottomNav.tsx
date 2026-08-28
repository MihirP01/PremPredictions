"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { CalendarDays, Gamepad2, House, Trophy } from "lucide-react";
import {
  getRoomBootstrapCached,
  peekRoomBootstrapCached,
  refreshRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
import { subscribeRoomGameDoc } from "@/lib/liveGameBus";
import { peekRoomGameStateCached } from "@/lib/gameStateClient";
import { useCachedBootstrap } from "@/lib/useRoomCache";
import { useAuth } from "./AuthProvider";
import useRoomScrollAffordance from "./useRoomScrollAffordance";

function timestampMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.toDate === "function")
      return candidate.toDate().getTime();
    const seconds = Number(candidate.seconds ?? candidate._seconds);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

function scheduleAt(atMs: number, run: () => void) {
  const delay = atMs - Date.now();
  if (delay <= 0 || delay > 2_000_000_000) return null;
  return window.setTimeout(run, delay);
}

function isLeaguePredictionsBlocked(
  snap: {
    leagueSubmittedByUid?: Record<string, boolean>;
    lockAt?: unknown;
  } | null,
  uid: string | undefined,
) {
  if (!snap) return false;
  if (uid && snap.leagueSubmittedByUid?.[uid] === true) return true;
  const lockAt = timestampMs(snap.lockAt);
  return lockAt != null && Date.now() >= lockAt;
}

type PredictionGameSnapshot = {
  state?: string;
  leagueSubmittedByUid?: Record<string, boolean>;
  lockAt?: unknown;
} | null;

function predictionsBlockedFor(
  boot: ReturnType<typeof peekRoomBootstrapCached>,
  game: PredictionGameSnapshot,
  uid: string | undefined,
) {
  if (!boot) return true;
  const state = String(game?.state || boot.gameState || "")
    .trim()
    .toUpperCase();
  const lockAt =
    timestampMs(game?.lockAt) ?? timestampMs(boot.predictionLockAt);

  if (boot.gameModeStyle === "league") {
    if (isLeaguePredictionsBlocked(game, uid)) return true;
    return lockAt != null && Date.now() >= lockAt;
  }

  if (state === "REVEAL" || state === "CLOSED") return true;
  return lockAt != null && Date.now() >= lockAt;
}

function readPredictionsBlocked(
  roomCode: string,
  uid: string | undefined,
): boolean | null {
  const boot = peekRoomBootstrapCached(roomCode);
  if (!boot) return null;
  const game = peekRoomGameStateCached(
    roomCode,
    boot.seasonKey,
    boot.currentGameweek,
  );
  return predictionsBlockedFor(boot, game, uid);
}

export function usePredictionsBlocked(roomCode: string) {
  const { user, loading } = useAuth();
  const bootstrap = useCachedBootstrap(roomCode);
  const [blocked, setBlocked] = useState<boolean | null>(() =>
    bootstrap ? readPredictionsBlocked(roomCode, user?.uid) : null,
  );
  const [watch, setWatch] = useState<{
    seasonKey: string;
    gw: number;
  } | null>(null);

  useEffect(() => {
    if (!roomCode || loading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const current = await getRoomBootstrapCached(roomCode);
        if (cancelled) return;
        const seasonKey = String(current.seasonKey || "");
        const gw = Number(current.currentGameweek || 1);
        if (!seasonKey || !Number.isFinite(gw)) return;
        setBlocked(readPredictionsBlocked(roomCode, user.uid));
        setWatch({ seasonKey, gw });
      } catch {
        if (!cancelled) {
          setWatch(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, roomCode, user]);

  useEffect(() => {
    if (!roomCode || !watch || loading || !user || !bootstrap) return;
    let cancelled = false;
    let lockTimer: number | null = null;
    let nextWeekTimer: number | null = null;

    const clearTimers = () => {
      if (lockTimer != null) window.clearTimeout(lockTimer);
      if (nextWeekTimer != null) window.clearTimeout(nextWeekTimer);
      lockTimer = null;
      nextWeekTimer = null;
    };

    const tryRollover = (attempt = 0) => {
      void refreshRoomBootstrapCached(roomCode)
        .then((next) => {
          if (cancelled) return;
          const nextGw = Number(next.currentGameweek || 1);
          if (Number.isFinite(nextGw) && nextGw !== watch.gw) {
            setWatch({
              seasonKey: String(next.seasonKey || watch.seasonKey),
              gw: nextGw,
            });
            setBlocked(readPredictionsBlocked(roomCode, user.uid));
            return;
          }
          setBlocked(readPredictionsBlocked(roomCode, user.uid));
          if (attempt < 8) {
            nextWeekTimer = window.setTimeout(
              () => tryRollover(attempt + 1),
              15000,
            );
          }
        })
        .catch(() => {
          if (!cancelled && attempt < 8) {
            nextWeekTimer = window.setTimeout(
              () => tryRollover(attempt + 1),
              15000,
            );
          }
        });
    };

    const predictionLockAt = timestampMs(bootstrap.predictionLockAt);
    const nextGameweekAt = timestampMs(bootstrap.nextGameweekAt);
    if (predictionLockAt != null && Date.now() < predictionLockAt) {
      lockTimer = scheduleAt(predictionLockAt, () => setBlocked(true));
    }
    if (nextGameweekAt != null) {
      if (Date.now() >= nextGameweekAt) tryRollover();
      else {
        nextWeekTimer = scheduleAt(nextGameweekAt + 750, () =>
          tryRollover(),
        );
      }
    }

    const unsub = subscribeRoomGameDoc(
      roomCode,
      watch.seasonKey,
      watch.gw,
      (snap) => {
        if (cancelled) return;
        const game = snap as PredictionGameSnapshot;
        setBlocked(predictionsBlockedFor(bootstrap, game, user.uid));
        const lockAt = timestampMs(game?.lockAt);
        const now = Date.now();
        if (lockTimer == null && lockAt != null && now < lockAt) {
          lockTimer = scheduleAt(lockAt, () => setBlocked(true));
        }
      },
      () => {
        // Keep the last known lock. A listener blip must not reopen Predictions.
      },
    );

    return () => {
      cancelled = true;
      unsub();
      clearTimers();
    };
  }, [bootstrap, loading, roomCode, user, watch]);

  return blocked !== false;
}

type NavItem = {
  key: "fixtures" | "predictions" | "home" | "leaderboard";
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  disabled?: boolean;
};

const NAV_MOTION_MS = 320;
const NAV_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const PILL_INSET = 8;

export default function RoomBottomNav() {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const roomCode = String(params?.roomCode || "").toUpperCase();
  const { user, loading } = useAuth();
  const predictionsBlocked = usePredictionsBlocked(roomCode);
  const bootstrap = useCachedBootstrap(roomCode);
  const [predictionsHref, setPredictionsHref] = useState<string>("");
  const [predictionsDisabled, setPredictionsDisabled] = useState(false);

  const gameModeStyle = bootstrap?.gameModeStyle ?? null;
  const isLeagueMode = gameModeStyle
    ? gameModeStyle === "league"
    : null;

  const lastTouchHandledAtRef = useRef(0);
  const navRef = useRef<HTMLDivElement | null>(null);
  const expandResetTimerRef = useRef<number | null>(null);
  const collapseLockUntilRef = useRef(0);
  const [slotWidth, setSlotWidth] = useState(0);

  useEffect(() => {
    if (!roomCode || loading || !user) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      try {
        const current = await getRoomBootstrapCached(roomCode);
        if (cancelled) return;
        const seasonKey = String(current?.seasonKey || "");
        const gw = Number(current?.currentGameweek || 1);
        const bootstrapState = String(current?.gameState || "")
          .trim()
          .toUpperCase();
        const leagueMode = current?.gameModeStyle === "league";
        if (leagueMode) {
          setPredictionsHref(`/room/${roomCode}/minigame/play`);
        } else if (bootstrapState === "REVEAL") {
          setPredictionsHref(`/room/${roomCode}/minigame/reveal`);
          setPredictionsDisabled(false);
        } else if (
          bootstrapState === "DRAFT" ||
          bootstrapState === "GOLDEN" ||
          bootstrapState === "POWERUPS"
        ) {
          setPredictionsHref(`/room/${roomCode}/minigame`);
          setPredictionsDisabled(true);
        } else {
          setPredictionsHref(`/room/${roomCode}/minigame`);
          setPredictionsDisabled(false);
        }

        if (!seasonKey || !Number.isFinite(gw)) return;

        unsub = subscribeRoomGameDoc(
          roomCode,
          seasonKey,
          gw,
          (snap) => {
            const state = String(
              (snap as { state?: string } | null)?.state || "",
            )
              .trim()
              .toUpperCase();

            if (leagueMode) {
              setPredictionsHref(`/room/${roomCode}/minigame/play`);
              return;
            }

            if (state === "REVEAL") {
              setPredictionsHref(`/room/${roomCode}/minigame/reveal`);
              setPredictionsDisabled(false);
              return;
            }
            if (
              state === "DRAFT" ||
              state === "GOLDEN" ||
              state === "POWERUPS"
            ) {
              setPredictionsHref(`/room/${roomCode}/minigame`);
              setPredictionsDisabled(true);
              return;
            }

            setPredictionsHref(`/room/${roomCode}/minigame`);
            setPredictionsDisabled(false);
          },
          () => {
            if (leagueMode) return;
            setPredictionsHref(`/room/${roomCode}/minigame`);
            setPredictionsDisabled(false);
          },
        );
      } catch {
        if (!cancelled) {
          setPredictionsHref(`/room/${roomCode}/minigame`);
          setPredictionsDisabled(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [
    bootstrap?.currentGameweek,
    bootstrap?.gameModeStyle,
    bootstrap?.gameState,
    bootstrap?.seasonKey,
    loading,
    roomCode,
    user,
  ]);

  const items: NavItem[] = useMemo(
    () => [
      {
        key: "fixtures",
        label: "Fixtures",
        href: `/room/${roomCode}/fixtures`,
        icon: CalendarDays,
        active: pathname === `/room/${roomCode}/fixtures`,
      },
      {
        key: "predictions",
        label: "Predictions",
        href: predictionsHref || `/room/${roomCode}/minigame`,
        icon: Gamepad2,
        active:
          pathname === `/room/${roomCode}/minigame` ||
          pathname.startsWith(`/room/${roomCode}/minigame/`),
        disabled:
          predictionsDisabled || predictionsBlocked,
      },
      {
        key: "home",
        label: "Hub",
        href: `/room/${roomCode}`,
        icon: House,
        active: pathname === `/room/${roomCode}`,
      },
      {
        key: "leaderboard",
        label: "Leaderboard",
        href: `/room/${roomCode}/leaderboard`,
        icon: Trophy,
        active: pathname === `/room/${roomCode}/leaderboard`,
      },
    ],
    [
      pathname,
      roomCode,
      predictionsDisabled,
      predictionsHref,
      predictionsBlocked,
    ],
  );
  const activeItem = items.find((item) => item.active) || items[2];
  const {
    visible: showScrollAffordance,
    cycle: affordanceCycle,
  } = useRoomScrollAffordance(pathname);
  const [expandedCycle, setExpandedCycle] = useState<number | null>(null);
  const desiredCollapsed =
    showScrollAffordance && expandedCycle !== affordanceCycle;
  const [collapsed, setCollapsed] = useState(desiredCollapsed);

  const hideForActiveGamePhase =
    isLeagueMode === false &&
    (pathname === `/room/${roomCode}/minigame/play` ||
      pathname === `/room/${roomCode}/minigame/golden` ||
      pathname === `/room/${roomCode}/minigame/powerups`);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.key === activeItem.key),
  );

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      const count = Math.max(items.length, 1);
      setSlotWidth((width - PILL_INSET * 2) / count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    if (collapsed === desiredCollapsed) return;
    const wait = Math.max(0, collapseLockUntilRef.current - Date.now());
    const apply = () => {
      setCollapsed(desiredCollapsed);
      collapseLockUntilRef.current = Date.now() + NAV_MOTION_MS;
    };
    if (wait === 0) {
      apply();
      return;
    }
    const timer = window.setTimeout(apply, wait);
    return () => window.clearTimeout(timer);
  }, [collapsed, desiredCollapsed]);

  useEffect(() => {
    if (collapsed || !showScrollAffordance) return;
    const onPointerDown = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return;
      setExpandedCycle(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [collapsed, showScrollAffordance]);

  useEffect(() => {
    if (showScrollAffordance || !expandResetTimerRef.current) return;
    window.clearTimeout(expandResetTimerRef.current);
    expandResetTimerRef.current = null;
  }, [showScrollAffordance]);

  useEffect(() => {
    return () => {
      if (expandResetTimerRef.current) {
        window.clearTimeout(expandResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    items.forEach((item) => router.prefetch(item.href));
  }, [items, router]);

  useEffect(() => {
    if (!roomCode) return;
    [
      `/room/${roomCode}/minigame`,
      `/room/${roomCode}/minigame/play`,
      `/room/${roomCode}/minigame/golden`,
      `/room/${roomCode}/minigame/powerups`,
      `/room/${roomCode}/minigame/reveal`,
    ].forEach((href) => router.prefetch(href));
  }, [roomCode, router]);

  const predictionsRouteForState = (state: string) =>
    String(state || "")
      .trim()
      .toUpperCase() === "REVEAL"
      ? `/room/${roomCode}/minigame/reveal`
      : `/room/${roomCode}/minigame`;

  const syncPredictionsRoute = (immediateHref: string) => {
    void getRoomBootstrapCached(roomCode)
      .then((bootstrap) => {
        const nextHref = predictionsRouteForState(bootstrap?.gameState || "");
        if (nextHref !== immediateHref) {
          router.replace(nextHref);
        }
      })
      .catch(() => {});
  };

  const collapseNavSoon = () => {
    if (expandResetTimerRef.current) {
      window.clearTimeout(expandResetTimerRef.current);
    }
    expandResetTimerRef.current = window.setTimeout(() => {
      setExpandedCycle(null);
      expandResetTimerRef.current = null;
    }, NAV_MOTION_MS);
  };

  const onNavClick = (
    _key: NavItem["key"],
    href: string,
    active: boolean,
    disabled?: boolean,
  ) => {
    if (collapsed) {
      setExpandedCycle(affordanceCycle);
      return;
    }
    if (active || disabled) return;
    if (_key === "predictions" && predictionsBlocked) return;
    if (_key === "predictions") {
      const cachedBootstrap = peekRoomBootstrapCached(roomCode);
      const immediateHref =
        predictionsHref ||
        predictionsRouteForState(cachedBootstrap?.gameState || "");
      router.push(immediateHref);
      if (!cachedBootstrap) syncPredictionsRoute(immediateHref);
      if (showScrollAffordance) collapseNavSoon();
      return;
    }
    router.push(href);
    if (showScrollAffordance) collapseNavSoon();
  };

  const onNavPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: NavItem,
  ) => {
    if (item.disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.pointerType === "mouse") return;
    lastTouchHandledAtRef.current = event.timeStamp;
    event.preventDefault();
    event.stopPropagation();
    onNavClick(item.key, item.href, item.active, item.disabled);
  };

  if (!roomCode || hideForActiveGamePhase) {
    return null;
  }

  return (
    <nav
      aria-label="Room navigation"
      className="room-bottom-nav sm:hidden mx-auto w-[min(94vw,520px)] pointer-events-auto"
      style={{
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        transform: "translateZ(0)",
        overscrollBehavior: "none",
      }}
    >
      <div
        className="overflow-hidden rounded-[30px]"
        style={{
          clipPath:
            slotWidth > 0
              ? `inset(0 0 0 ${collapsed ? (items.length - 1) * slotWidth : 0}px round 30px)`
              : undefined,
          transition: `clip-path ${NAV_MOTION_MS}ms ${NAV_EASE}`,
        }}
      >
      <div
        ref={navRef}
        className="liquid-glass-nav relative w-full px-2 py-2"
      >
        <div
          aria-hidden="true"
          className="liquid-glass-pill"
          style={
            {
              ["--pill-width" as string]:
                slotWidth > 0 ? `${slotWidth}px` : "20%",
              ["--pill-x" as string]: `${(collapsed ? items.length - 1 : activeIndex) * (slotWidth || 0)}px`,
            } as React.CSSProperties
          }
        />
        <div
          className="relative z-[1] flex items-stretch"
          style={{
            transform: `translate3d(${collapsed ? (items.length - 1 - activeIndex) * (slotWidth || 0) : 0}px,0,0)`,
            transition: `transform ${NAV_MOTION_MS}ms ${NAV_EASE}`,
            willChange: "transform",
          }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            const itemCollapsed = collapsed && !item.active;

            return (
              <div
                key={item.key}
                className="relative min-w-0"
                style={{
                  flex: "1 1 0%",
                  width: 0,
                  pointerEvents: itemCollapsed || item.disabled ? "none" : "auto",
                }}
              >
                <button
                  type="button"
                  onPointerDown={(event) => onNavPointerDown(event, item)}
                  onClick={() => {
                    if (performance.now() - lastTouchHandledAtRef.current < 450)
                      return;
                    onNavClick(item.key, item.href, item.active, item.disabled);
                  }}
                  disabled={item.disabled}
                  aria-disabled={item.disabled ? "true" : undefined}
                  className={[
                    "liquid-glass-tab flex w-full min-w-0 touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-[24px] px-1 py-1.5",
                    item.disabled
                      ? "pointer-events-none cursor-not-allowed opacity-50"
                      : "pointer-events-auto",
                    item.active && !item.disabled ? "liquid-glass-tab-active" : "",
                  ].join(" ")}
                >
                  <span className="nav-icon-wrap relative inline-flex h-5 w-5 items-center justify-center">
                    <Icon
                      size={16}
                      className={item.active ? "text-white" : "text-white/64"}
                    />
                  </span>
                  <span
                    className={[
                      "truncate font-display text-[8px] font-semibold leading-none tracking-[0.03em]",
                      item.active ? "text-white" : "text-white/68",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </nav>
  );
}
