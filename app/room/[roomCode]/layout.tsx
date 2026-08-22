"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../components/AuthProvider";
import ScrollToTopButton from "../../../components/ScrollToTopButton";
import RoomBottomNav from "../../../components/RoomBottomNav";
import { getRoomBootstrapCached, peekRoomBootstrapCached, refreshRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getFixturesCached, refreshFixturesCached } from "@/lib/fixturesClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getTableCached } from "@/lib/tableClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { canonicalRoomCode } from "@/lib/roomCode";

type AccentTheme = {
  hex: string;
  rgb: string;
  bgLight: string;
  bgDark: string;
  solidLight: string;
  solidDark: string;
};

const ACCENT_THEME: Record<string, AccentTheme> = {
  teal: {
    hex: "#2dd4bf",
    rgb: "45,212,191",
    bgLight: "linear-gradient(145deg, #ecfeff, #d4f8f3, #b2f5ea)",
    bgDark: "linear-gradient(145deg, #07111f, #0d2036, #102e40)",
    solidLight: "#ecfeff",
    solidDark: "#07111f",
  },
  blue: {
    hex: "#60a5fa",
    rgb: "96,165,250",
    bgLight: "linear-gradient(145deg, #eff6ff, #dbeafe, #bfdbfe)",
    bgDark: "linear-gradient(145deg, #07111f, #10294a, #123654)",
    solidLight: "#eff6ff",
    solidDark: "#07111f",
  },
  emerald: {
    hex: "#34d399",
    rgb: "52,211,153",
    bgLight: "linear-gradient(145deg, #ecfdf5, #d1fae5, #a7f3d0)",
    bgDark: "linear-gradient(145deg, #07111f, #0f2c2a, #123a35)",
    solidLight: "#ecfdf5",
    solidDark: "#07111f",
  },
  orange: {
    hex: "#fb923c",
    rgb: "251,146,60",
    bgLight: "linear-gradient(145deg, #fff7ed, #ffedd5, #fed7aa)",
    bgDark: "linear-gradient(145deg, #07111f, #2f2318, #433428)",
    solidLight: "#fff7ed",
    solidDark: "#07111f",
  },
  rose: {
    hex: "#fb7185",
    rgb: "251,113,133",
    bgLight: "linear-gradient(145deg, #fff1f2, #ffe4e6, #fecdd3)",
    bgDark: "linear-gradient(145deg, #07111f, #2f1f33, #3d2740)",
    solidLight: "#fff1f2",
    solidDark: "#07111f",
  },
  red: {
    hex: "#ef4444",
    rgb: "239,68,68",
    bgLight: "linear-gradient(145deg, #fef2f2, #fee2e2, #fecaca)",
    bgDark: "linear-gradient(145deg, #07111f, #2a1d2a, #3a2231)",
    solidLight: "#fef2f2",
    solidDark: "#07111f",
  },
  slate: {
    hex: "#94a3b8",
    rgb: "148,163,184",
    bgLight: "linear-gradient(145deg, #f8fafc, #e2e8f0, #cbd5e1)",
    bgDark: "linear-gradient(145deg, #07111f, #1a2738, #213245)",
    solidLight: "#f8fafc",
    solidDark: "#07111f",
  },
};

type RoomDoc = {
  settings?: {
    themeAccent?: string;
  };
};

export default function RoomScopedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const navDockRef = useRef<HTMLDivElement | null>(null);
  const params = useParams<{ roomCode: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const rawRoomCode = useMemo(
    () => String(params.roomCode || "").toUpperCase(),
    [params.roomCode],
  );
  const roomCode = useMemo(
    () => canonicalRoomCode(rawRoomCode),
    [rawRoomCode],
  );
  const [accentKey, setAccentKey] = useState<string>("teal");
  const [showBootOverlay, setShowBootOverlay] = useState(false);
  const [bootProgress, setBootProgress] = useState(0);
  const [bootHint, setBootHint] = useState<{
    seasonKey: string;
    gw: number;
    gameState: string;
  } | null>(null);
  const redirectedRef = useRef(false);
  const initialVarsRef = useRef<{ bg: string; solid: string } | null>(null);
  const bootedRef = useRef(false);
  const lastWarmAtRef = useRef(0);
  const warmInFlightRef = useRef<Promise<void> | null>(null);
  const prefetchedKeyRef = useRef<string>("");
  const warmedDataKeyRef = useRef<string>("");
  const idleTasksRef = useRef<number[]>([]);
  const bootHideTimerRef = useRef<number | null>(null);
  const bootProgressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!rawRoomCode || rawRoomCode === roomCode) return;
    const suffix = pathname.replace(/^\/room\/[^/]+/i, "");
    router.replace(`/room/${roomCode}${suffix}`);
  }, [rawRoomCode, roomCode, pathname, router]);

  useEffect(() => {
    if (loading || !user || !roomCode) return;
    if (rawRoomCode !== roomCode) return;
    const membershipRef = doc(db, "rooms", roomCode, "players", user.uid);
    const forceToRoomGate = () => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      setDoc(
        doc(db, "users", user.uid),
        { currentRoomCode: null },
        { merge: true },
      ).catch(() => {});
      router.replace("/room-gate?kicked=1");
    };
    const unsub = onSnapshot(
      membershipRef,
      (snap) => {
        if (snap.exists()) {
          redirectedRef.current = false;
          return;
        }
        forceToRoomGate();
      },
      () => {
        // Transient Firestore errors after a long background must not kick.
      },
    );
    return () => unsub();
  }, [loading, user, roomCode, rawRoomCode, router]);

  useEffect(() => {
    if (!roomCode) return;
    const ref = doc(db, "rooms", roomCode);
    const unsub = onSnapshot(ref, (snap) => {
      const room = snap.data() as RoomDoc | undefined;
      const key = String(room?.settings?.themeAccent || "teal").toLowerCase();
      setAccentKey(ACCENT_THEME[key] ? key : "teal");
    });
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    let overlayTimer: number | null = null;
      const RESUME_WARM_COOLDOWN_MS = 15 * 1000;

    const WARM_TIMEOUT_MS = 4000;
    const withTimeout = async <T,>(promise: Promise<T>, ms: number) => {
      let timer: number | null = null;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("warm-timeout")),
              ms,
            );
          }),
        ]);
      } finally {
        if (timer != null) window.clearTimeout(timer);
      }
    };

    const warm = async (isResume = false) => {
      if (warmInFlightRef.current) return;
      if (
        bootedRef.current &&
        Date.now() - lastWarmAtRef.current < RESUME_WARM_COOLDOWN_MS
      ) {
        return;
      }
      const hasStale = !!peekRoomBootstrapCached(roomCode);
      if (!bootedRef.current && !isResume && !hasStale) {
        overlayTimer = window.setTimeout(() => {
          if (!cancelled) setShowBootOverlay(true);
        }, 150);
      }
      const run = (async () => {
        try {
          const bootstrap = await withTimeout(
            bootedRef.current || isResume
              ? refreshRoomBootstrapCached(roomCode)
              : getRoomBootstrapCached(roomCode),
            WARM_TIMEOUT_MS,
          );
          if (
            bootstrap?.seasonKey &&
            Number.isFinite(bootstrap?.currentGameweek)
          ) {
            const gw = bootstrap.currentGameweek;
            const season = bootstrap.seasonKey;
            const gameState = String(bootstrap.gameState || "")
              .trim()
              .toUpperCase();
            if (!cancelled) setBootHint({ seasonKey: season, gw, gameState });
            const warmKey = `${roomCode}:${season}:gw-${gw}`;
            if (warmedDataKeyRef.current !== warmKey) {
              warmedDataKeyRef.current = warmKey;
              void getFixturesCached(gw, season).catch(() => {});
              void getRoomGameStateCached(roomCode, season, gw).catch(() => {});
            } else if (bootedRef.current) {
              void refreshFixturesCached(gw, season).catch(() => {});
            }

              const scheduleIdle = (fn: () => void) => {
                const w = window as Window & {
                  requestIdleCallback?: (
                    cb: () => void,
                    opts?: { timeout: number },
                  ) => number;
                };
                if (w.requestIdleCallback) {
                  const id = w.requestIdleCallback(fn, { timeout: 1200 });
                  idleTasksRef.current.push(id);
                  return;
                }
                const id = window.setTimeout(fn, 180);
                idleTasksRef.current.push(id);
              };

              scheduleIdle(() => {
                void getGameDataCached(roomCode, season, gw, {
                  includeChips: bootstrap.gameModeStyle !== "league",
                }).catch(() => {});
                void getTableCached(season).catch(() => {});
                void getRoomPlayersCached(roomCode).catch(() => {});
              });
          }
          lastWarmAtRef.current = Date.now();
        } catch {
          // no-op
        } finally {
          bootedRef.current = true;
          if (overlayTimer != null) window.clearTimeout(overlayTimer);
          if (!cancelled) {
            setBootProgress(100);
            if (bootHideTimerRef.current)
              window.clearTimeout(bootHideTimerRef.current);
            bootHideTimerRef.current = window.setTimeout(() => {
              if (!cancelled) setShowBootOverlay(false);
              bootHideTimerRef.current = null;
            }, 220);
          }
        }
      })();
      warmInFlightRef.current = run;
      await run;
      if (warmInFlightRef.current === run) warmInFlightRef.current = null;
    };

    void warm(false);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setShowBootOverlay(false);
      lastWarmAtRef.current = 0;
      void warm(true);
    };
    const onFocus = () => {
      setShowBootOverlay(false);
      lastWarmAtRef.current = 0;
      void warm(true);
    };
    const onPageShow = () => {
      setShowBootOverlay(false);
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      if (overlayTimer != null) window.clearTimeout(overlayTimer);
      if (bootHideTimerRef.current) {
        window.clearTimeout(bootHideTimerRef.current);
        bootHideTimerRef.current = null;
      }
      const w = window as Window & {
        cancelIdleCallback?: (id: number) => void;
      };
      idleTasksRef.current.forEach((id) => {
        if (w.cancelIdleCallback) w.cancelIdleCallback(id);
        else window.clearTimeout(id);
      });
      idleTasksRef.current = [];
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [roomCode]);

  useEffect(() => {
    if (!showBootOverlay) {
      if (bootProgressTimerRef.current) {
        window.clearInterval(bootProgressTimerRef.current);
        bootProgressTimerRef.current = null;
      }
      setBootProgress(0);
      return;
    }

    setBootProgress((prev) => Math.max(prev, 8));
    if (bootProgressTimerRef.current)
      window.clearInterval(bootProgressTimerRef.current);
    bootProgressTimerRef.current = window.setInterval(() => {
      setBootProgress((prev) => {
        if (prev >= 92) return prev;
        if (prev < 40) return Math.min(92, prev + 9);
        if (prev < 68) return Math.min(92, prev + 5);
        return Math.min(92, prev + 2);
      });
    }, 110);

    return () => {
      if (bootProgressTimerRef.current) {
        window.clearInterval(bootProgressTimerRef.current);
        bootProgressTimerRef.current = null;
      }
    };
  }, [showBootOverlay]);

  useEffect(() => {
    if (!roomCode || !bootHint?.seasonKey || !Number.isFinite(bootHint.gw))
      return;
    const key = `${roomCode}:${bootHint.seasonKey}:${bootHint.gw}:${bootHint.gameState}`;
    if (prefetchedKeyRef.current === key) return;
    prefetchedKeyRef.current = key;

    const base = `/room/${roomCode}`;
    const predictionsHref =
      bootHint.gameState === "REVEAL"
        ? `${base}/minigame/reveal`
        : `${base}/minigame`;
    const routes = [
      `${base}`,
      `${base}/fixtures`,
      predictionsHref,
      `${base}/minigame/play`,
      `${base}/minigame/golden`,
      `${base}/minigame/powerups`,
      `${base}/minigame/reveal`,
      `${base}/leaderboard`,
      `${base}/stats`,
    ];
    routes.forEach((href) => {
      void router.prefetch(href);
    });
  }, [bootHint, roomCode, router]);

  const accent = ACCENT_THEME[accentKey] || ACCENT_THEME.teal;
  const hideBottomNav =
    pathname.startsWith(`/room/${roomCode}/minigame/play`) ||
    pathname.startsWith(`/room/${roomCode}/minigame/golden`) ||
    pathname.startsWith(`/room/${roomCode}/minigame/powerups`);

  useEffect(() => {
    const root = document.documentElement;
    initialVarsRef.current = {
      bg: root.style.getPropertyValue("--app-bg"),
      solid: root.style.getPropertyValue("--app-solid"),
    };
    root.classList.add("room-shell-active");
    document.body.classList.add("room-shell-active");
    return () => {
      const initial = initialVarsRef.current;
      root.classList.remove("room-shell-active");
      document.body.classList.remove("room-shell-active");
      if (!initial) return;
      if (initial.bg) root.style.setProperty("--app-bg", initial.bg);
      else root.style.removeProperty("--app-bg");
      if (initial.solid) root.style.setProperty("--app-solid", initial.solid);
      else root.style.removeProperty("--app-solid");
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-bg", accent.bgDark);
    root.style.setProperty("--app-solid", accent.solidDark);
  }, [accent.bgDark, accent.solidDark]);

  useEffect(() => {
    const shell = shellRef.current;
    const navDock = navDockRef.current;
    if (!shell || !navDock) return;

    const applyOffset = () => {
      shell.style.setProperty("--room-nav-offset", `${navDock.offsetHeight}px`);
    };

    applyOffset();

    const observer = new ResizeObserver(() => applyOffset());
    observer.observe(navDock);
    window.addEventListener("resize", applyOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", applyOffset);
      shell.style.removeProperty("--room-nav-offset");
    };
  }, [hideBottomNav]);

  return (
    <div
      ref={shellRef}
      className={
        hideBottomNav
          ? "room-theme room-shell"
          : "room-theme room-shell room-has-bottom-nav"
      }
      style={
        {
          "--room-accent": accent.hex,
          "--room-accent-rgb": accent.rgb,
          "--accent": accent.hex,
          "--shadow-card": `0 16px 44px rgba(${accent.rgb}, 0.14)`,
        } as React.CSSProperties
      }
    >
      {showBootOverlay ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(4,12,24,0.68)] px-6 backdrop-blur-sm">
          <div
            className="relative mx-auto w-fit font-display text-[clamp(3.8rem,18vw,7rem)] font-semibold leading-none tracking-[-0.03em]"
            style={
              {
                "--boot-fill": `${Math.max(0, 100 - bootProgress)}%`,
              } as React.CSSProperties
            }
          >
            <span className="select-none text-white/10">{bootProgress}%</span>
            <span className="boot-liquid-fill absolute inset-0 select-none">
              {bootProgress}%
            </span>
          </div>
        </div>
      ) : null}
      <div id="room-scroll-root" className="room-scroll-root min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
      <div
        ref={navDockRef}
        className={[
          "pointer-events-none absolute inset-x-0 bottom-0 z-[80] flex justify-center px-3",
          hideBottomNav ? "invisible" : "",
        ].join(" ")}
        style={{
          paddingBottom: "max(0.18rem, env(safe-area-inset-bottom))",
        }}
        aria-hidden={hideBottomNav ? true : undefined}
      >
        <RoomBottomNav />
      </div>
      <ScrollToTopButton />
    </div>
  );
}
