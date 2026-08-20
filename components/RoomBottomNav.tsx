"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Gamepad2, House, Trophy } from "lucide-react";
import {
  getRoomBootstrapCached,
  peekRoomBootstrapCached,
  refreshRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
import { subscribeRoomGameDoc } from "@/lib/liveGameBus";
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

export function useLeaguePredictionsBlocked(roomCode: string) {
  const { user } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const [watch, setWatch] = useState<{
    seasonKey: string;
    gw: number;
  } | null>(null);

  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;

    (async () => {
      try {
        let current = await getRoomBootstrapCached(roomCode);
        if (cancelled) return;
        if (current.gameModeStyle !== "league") {
          setWatch(null);
          setBlocked(false);
          return;
        }
        current = await refreshRoomBootstrapCached(roomCode);
        if (cancelled) return;
        const seasonKey = String(current.seasonKey || "");
        const gw = Number(current.currentGameweek || 1);
        if (!seasonKey || !Number.isFinite(gw)) return;
        setWatch({ seasonKey, gw });
      } catch {
        if (!cancelled) {
          setWatch(null);
          setBlocked(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode || !watch) return;
    let cancelled = false;
    let lockTimer: number | null = null;
    let nextWeekTimer: number | null = null;

    const clearTimers = () => {
      if (lockTimer != null) window.clearTimeout(lockTimer);
      if (nextWeekTimer != null) window.clearTimeout(nextWeekTimer);
      lockTimer = null;
      nextWeekTimer = null;
    };

    let rolloverStarted = false;
    const tryRollover = (attempt: number) => {
      void refreshRoomBootstrapCached(roomCode).then((next) => {
        if (cancelled) return;
        const nextGw = Number(next.currentGameweek || 1);
        if (Number.isFinite(nextGw) && nextGw !== watch.gw) {
          setWatch({
            seasonKey: String(next.seasonKey || watch.seasonKey),
            gw: nextGw,
          });
          setBlocked(false);
          return;
        }
        if (attempt < 8) {
          nextWeekTimer = window.setTimeout(
            () => tryRollover(attempt + 1),
            15000,
          );
        }
      });
    };

    const unsub = subscribeRoomGameDoc(
      roomCode,
      watch.seasonKey,
      watch.gw,
      (snap) => {
        if (cancelled) return;
        const game = snap as {
          leagueSubmittedByUid?: Record<string, boolean>;
          lockAt?: unknown;
          firstKickoffAt?: unknown;
        } | null;
        setBlocked(isLeaguePredictionsBlocked(game, user?.uid));
        const lockAt = timestampMs(game?.lockAt);
        const firstKickoff = timestampMs(game?.firstKickoffAt);
        const now = Date.now();
        if (lockTimer == null && lockAt != null && now < lockAt) {
          lockTimer = scheduleAt(lockAt, () => setBlocked(true));
        }
        if (rolloverStarted) return;
        if (firstKickoff != null && now >= firstKickoff) {
          rolloverStarted = true;
          tryRollover(0);
        } else if (
          nextWeekTimer == null &&
          firstKickoff != null &&
          now < firstKickoff
        ) {
          nextWeekTimer = scheduleAt(firstKickoff + 750, () => {
            rolloverStarted = true;
            tryRollover(0);
          });
        }
      },
      () => {
        if (!cancelled) setBlocked(false);
      },
    );

    return () => {
      cancelled = true;
      unsub();
      clearTimers();
    };
  }, [roomCode, watch, user?.uid]);

  return blocked;
}

type NavItem = {
  key: "fixtures" | "predictions" | "home" | "leaderboard" | "stats";
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  disabled?: boolean;
};

export default function RoomBottomNav() {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const roomCode = String(params?.roomCode || "").toUpperCase();
  const leaguePredictionsBlocked = useLeaguePredictionsBlocked(roomCode);
  const [predictionsHref, setPredictionsHref] = useState<string>("");
  const [predictionsDisabled, setPredictionsDisabled] = useState(false);
  const [isLeagueMode, setIsLeagueMode] = useState(false);
  const [activeBubble, setActiveBubble] = useState<{
    left: number;
    width: number;
    visible: boolean;
  }>({ left: 0, width: 0, visible: false });
  const lastTouchHandledAtRef = useRef(0);
  const navRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<
    Partial<Record<NavItem["key"], HTMLButtonElement | null>>
  >({});
  const expandResetTimerRef = useRef<number | null>(null);
  const bubbleHoldTimerRef = useRef<number | null>(null);
  const previousCollapsedRef = useRef(false);
  const bubblePinnedToTrackRef = useRef(false);
  const collapsedBubbleRectRef = useRef<{ left: number; width: number } | null>(
    null,
  );

  useEffect(() => {
    if (!roomCode) return;
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
        if (!cancelled) setIsLeagueMode(leagueMode);

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
  }, [roomCode]);

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
        disabled: isLeagueMode
          ? leaguePredictionsBlocked
          : predictionsDisabled,
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
      {
        key: "stats",
        label: "Stats",
        href: `/room/${roomCode}/stats`,
        icon: BarChart3,
        active: pathname === `/room/${roomCode}/stats`,
      },
    ],
    [
      pathname,
      roomCode,
      predictionsDisabled,
      predictionsHref,
      isLeagueMode,
      leaguePredictionsBlocked,
    ],
  );
  const activeItem = items.find((item) => item.active) || items[2];
  const {
    visible: showScrollAffordance,
    cycle: affordanceCycle,
  } = useRoomScrollAffordance(pathname);
  const [expandedCycle, setExpandedCycle] = useState<number | null>(null);
  const collapsed = showScrollAffordance && expandedCycle !== affordanceCycle;

  const hideForActiveGamePhase =
    !isLeagueMode &&
    (pathname === `/room/${roomCode}/minigame/play` ||
      pathname === `/room/${roomCode}/minigame/golden` ||
      pathname === `/room/${roomCode}/minigame/powerups`);

  const syncActiveBubble = useCallback(() => {
    const nav = navRef.current;
    const activeButton = activeItem ? buttonRefs.current[activeItem.key] : null;
    if (!nav || !activeButton) {
      setActiveBubble((current) =>
        current.visible ? { ...current, visible: false } : current,
      );
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const liveButtonRect = activeButton.getBoundingClientRect();
    if (collapsed) {
      collapsedBubbleRectRef.current = {
        left: liveButtonRect.left - navRect.left,
        width: liveButtonRect.width,
      };
    }

    const storedRect = collapsedBubbleRectRef.current;
    const nextLeft =
      bubblePinnedToTrackRef.current && storedRect
        ? storedRect.left
        : liveButtonRect.left - navRect.left;
    const nextWidth =
      bubblePinnedToTrackRef.current && storedRect
        ? storedRect.width
        : liveButtonRect.width;

    setActiveBubble({
      left: nextLeft,
      width: nextWidth,
      visible: true,
    });
  }, [activeItem, collapsed]);

  useEffect(() => {
    const wasCollapsed = previousCollapsedRef.current;
    previousCollapsedRef.current = collapsed;

    if (bubbleHoldTimerRef.current) {
      window.clearTimeout(bubbleHoldTimerRef.current);
      bubbleHoldTimerRef.current = null;
    }

    if (collapsed) {
      bubblePinnedToTrackRef.current = true;
      window.requestAnimationFrame(syncActiveBubble);
      return;
    }

    if (wasCollapsed) {
      bubblePinnedToTrackRef.current = true;
      window.requestAnimationFrame(syncActiveBubble);
      bubbleHoldTimerRef.current = window.setTimeout(() => {
        bubblePinnedToTrackRef.current = false;
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(syncActiveBubble);
        });
        bubbleHoldTimerRef.current = null;
      }, 240);
      return;
    }

    bubblePinnedToTrackRef.current = false;
  }, [collapsed, syncActiveBubble]);

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
      if (bubbleHoldTimerRef.current) {
        window.clearTimeout(bubbleHoldTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    items.forEach((item) => router.prefetch(item.href));
  }, [items, router]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(syncActiveBubble);
    });
    const onResize = () => {
      window.requestAnimationFrame(syncActiveBubble);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [syncActiveBubble]);

  useEffect(() => {
    const nav = navRef.current;
    const activeButton = activeItem ? buttonRefs.current[activeItem.key] : null;
    if (!nav || !activeButton || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(syncActiveBubble);
    });

    observer.observe(nav);
    observer.observe(activeButton);
    return () => observer.disconnect();
  }, [activeItem, collapsed, syncActiveBubble]);

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
    }, 180);
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
        ref={navRef}
        className="relative overflow-hidden rounded-[30px] px-2 py-2 transition-[width] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          isolation: "isolate",
          width: collapsed ? "7.25rem" : "100%",
          marginLeft: "auto",
          transformOrigin: "right center",
        }}
      >
        <div
          className="absolute inset-0 rounded-[31px] border"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(9,14,26,0.78) 0%, rgba(8,12,22,0.82) 100%)",
            boxShadow:
              "0 18px 36px rgba(2,7,18,0.24), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(255,255,255,0.03)",
            backdropFilter: "blur(24px) saturate(175%)",
            WebkitBackdropFilter: "blur(24px) saturate(175%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-10 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-8 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 rounded-[24px] transition-[left,width,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            left: `${activeBubble.left}px`,
            width: `${activeBubble.width}px`,
            opacity: activeBubble.visible ? 1 : 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(var(--room-accent-rgb),0.14) 100%)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow:
              "0 8px 18px rgba(2,7,18,0.14), inset 0 1px 0 rgba(255,255,255,0.16), 0 0 0 1px rgba(var(--room-accent-rgb),0.08)",
            backdropFilter: "blur(18px) saturate(150%)",
            WebkitBackdropFilter: "blur(18px) saturate(150%)",
          }}
        >
          <div
            className="absolute inset-[1px] rounded-[23px]"
            style={{
              background:
                "radial-gradient(circle at top center, rgba(255,255,255,0.12), transparent 52%), linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))",
            }}
          />
          <div
            className="absolute left-[22%] right-[22%] top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
            }}
          />
        </div>
        <div
          className={[
            "relative z-[1]",
            collapsed ? "flex items-stretch gap-0" : "flex items-stretch gap-1",
          ].join(" ")}
        >
          {items.map((item) => {
            const Icon = item.icon;
            const itemCollapsed = collapsed && !item.active;

            return (
              <div
                key={item.key}
                className="relative min-w-0 overflow-hidden transition-[flex,width,opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={
                  itemCollapsed
                    ? {
                        flex: "0 0 0px",
                        width: 0,
                        opacity: 0,
                        transform: "scale(0.92)",
                        pointerEvents: "none",
                      }
                    : collapsed
                      ? {
                          flex: "1 1 auto",
                          width: "100%",
                          opacity: 1,
                          transform: "scale(1)",
                          pointerEvents: item.disabled ? "none" : "auto",
                        }
                      : {
                          flex: "1 1 0%",
                          width: 0,
                          opacity: 1,
                          transform: "scale(1)",
                          pointerEvents: item.disabled ? "none" : "auto",
                        }
                }
              >
                <button
                  ref={(node) => {
                    buttonRefs.current[item.key] = node;
                  }}
                  type="button"
                  onPointerDown={(event) => onNavPointerDown(event, item)}
                  onClick={() => {
                    if (performance.now() - lastTouchHandledAtRef.current < 450) return;
                    onNavClick(item.key, item.href, item.active, item.disabled);
                  }}
                  disabled={item.disabled}
                  aria-disabled={item.disabled ? "true" : undefined}
                  className={[
                    "relative flex w-full min-w-0 min-h-[56px] touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-[24px] px-1 py-1.5 transition-colors duration-250 ease-out",
                    item.disabled
                      ? "pointer-events-none text-muted opacity-50 cursor-not-allowed"
                      : "pointer-events-auto",
                    item.active && !item.disabled ? "text-foreground" : "",
                    !item.active && !item.disabled ? "text-muted" : "",
                  ].join(" ")}
                >
                  <span className="nav-icon-wrap relative inline-flex h-5 w-5 items-center justify-center">
                    <Icon
                      size={16}
                      className={[item.active ? "text-white" : "text-white/64"].join(" ")}
                    />
                  </span>
                  <span
                    className={[
                      "truncate font-display text-[8px] font-semibold leading-none tracking-[0.03em] transition-colors duration-250 ease-out",
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
    </nav>
  );
}
