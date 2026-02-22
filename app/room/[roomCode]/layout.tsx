"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../components/AuthProvider";
import ScrollToTopButton from "../../../components/ScrollToTopButton";
import RoomBottomNav from "../../../components/RoomBottomNav";
import {
  getRoomBootstrapCached,
  refreshRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getTableCached } from "@/lib/tableClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";

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
    bgLight: "linear-gradient(135deg, #d9f2f0, #a7e1dc, #6fc3bf)",
    bgDark: "linear-gradient(135deg, #06181c, #0b3b3a, #0ea5a4)",
    solidLight: "#d9f2f0",
    solidDark: "#06181c",
  },
  blue: {
    hex: "#60a5fa",
    rgb: "96,165,250",
    bgLight: "linear-gradient(135deg, #e2ecff, #c6daff, #98bfff)",
    bgDark: "linear-gradient(135deg, #081325, #132b4d, #2563eb)",
    solidLight: "#e2ecff",
    solidDark: "#081325",
  },
  emerald: {
    hex: "#34d399",
    rgb: "52,211,153",
    bgLight: "linear-gradient(135deg, #dff8ee, #baf0dd, #86e0be)",
    bgDark: "linear-gradient(135deg, #071c16, #124737, #059669)",
    solidLight: "#dff8ee",
    solidDark: "#071c16",
  },
  orange: {
    hex: "#fb923c",
    rgb: "251,146,60",
    bgLight: "linear-gradient(135deg, #fff0e2, #ffd7b3, #ffb57a)",
    bgDark: "linear-gradient(135deg, #241306, #4f2a0f, #c2410c)",
    solidLight: "#fff0e2",
    solidDark: "#241306",
  },
  rose: {
    hex: "#fb7185",
    rgb: "251,113,133",
    bgLight: "linear-gradient(135deg, #ffe6ec, #ffc9d5, #ff9eb3)",
    bgDark: "linear-gradient(135deg, #260a13, #532136, #be185d)",
    solidLight: "#ffe6ec",
    solidDark: "#260a13",
  },
  red: {
    hex: "#ef4444",
    rgb: "239,68,68",
    bgLight: "linear-gradient(135deg, #ffe7e7, #ffc8c8, #ff9e9e)",
    bgDark: "linear-gradient(135deg, #2a0c0c, #5a1717, #b91c1c)",
    solidLight: "#ffe7e7",
    solidDark: "#2a0c0c",
  },
  slate: {
    hex: "#94a3b8",
    rgb: "148,163,184",
    bgLight: "linear-gradient(135deg, #edf1f6, #d8e0eb, #becadb)",
    bgDark: "linear-gradient(135deg, #0f172a, #1e293b, #334155)",
    solidLight: "#edf1f6",
    solidDark: "#0f172a",
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
  const params = useParams<{ roomCode: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const roomCode = useMemo(
    () => String(params.roomCode || "").toUpperCase(),
    [params.roomCode],
  );
  const [accentKey, setAccentKey] = useState<string>("teal");
  const [showBootOverlay, setShowBootOverlay] = useState(false);
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
  const idleTasksRef = useRef<number[]>([]);

  useEffect(() => {
    if (loading || !user || !roomCode) return;
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
        // When kicked, rules can deny read before `exists=false` is delivered.
        forceToRoomGate();
      },
    );
    return () => unsub();
  }, [loading, user, roomCode, router]);

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

  // Phase 1 bootstrap:
  // warm shared current-GW cache once on room open, and refresh on app resume.
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    let overlayTimer: number | null = null;

    const warm = async (force = false) => {
      if (warmInFlightRef.current) {
        await warmInFlightRef.current;
        return;
      }
      if (!force && Date.now() - lastWarmAtRef.current < 30_000) return;
      if (force && Date.now() - lastWarmAtRef.current < 8_000) return;
      if (!bootedRef.current) {
        overlayTimer = window.setTimeout(() => {
          if (!cancelled) setShowBootOverlay(true);
        }, 150);
      }
      const run = (async () => {
        try {
          const bootstrap = force
            ? await refreshRoomBootstrapCached(roomCode)
            : await getRoomBootstrapCached(roomCode);
          // Warm current-GW caches for faster navigation between tabs.
          if (bootstrap?.seasonKey && Number.isFinite(bootstrap?.currentGameweek)) {
            const gw = bootstrap.currentGameweek;
            const season = bootstrap.seasonKey;
            const gameState = String(bootstrap.gameState || "").trim().toUpperCase();
            if (!cancelled) setBootHint({ seasonKey: season, gw, gameState });
            // Critical prewarm first (fast first render/nav)
            void getFixturesCached(gw, season).catch(() => {});
            void getRoomGameStateCached(
              roomCode,
              season,
              gw,
            ).catch(() => {});

            const scheduleIdle = (fn: () => void) => {
              const w = window as Window & {
                requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
              };
              if (w.requestIdleCallback) {
                const id = w.requestIdleCallback(fn, { timeout: 1200 });
                idleTasksRef.current.push(id);
                return;
              }
              const id = window.setTimeout(fn, 180);
              idleTasksRef.current.push(id);
            };

            // Non-critical prewarm on idle to reduce startup jank
            scheduleIdle(() => {
              void getGameDataCached(roomCode, season, gw).catch(() => {});
              void getTableCached(season).catch(() => {});
              void getRoomPlayersCached(roomCode).catch(() => {});
            });
          }
          lastWarmAtRef.current = Date.now();
        } catch {
          // no-op; pages still fetch directly as fallback
        } finally {
          bootedRef.current = true;
          if (overlayTimer != null) window.clearTimeout(overlayTimer);
          if (!cancelled) setShowBootOverlay(false);
        }
      })();
      warmInFlightRef.current = run;
      await run;
      if (warmInFlightRef.current === run) warmInFlightRef.current = null;
    };

    void warm(false);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void warm(true);
    };
    const onFocus = () => {
      void warm(true);
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (overlayTimer != null) window.clearTimeout(overlayTimer);
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
    };
  }, [roomCode]);

  // Phase 17: route prefetch from bootstrap hint for snappier first nav taps.
  useEffect(() => {
    if (!roomCode || !bootHint?.seasonKey || !Number.isFinite(bootHint.gw)) return;
    const key = `${roomCode}:${bootHint.seasonKey}:${bootHint.gw}:${bootHint.gameState}`;
    if (prefetchedKeyRef.current === key) return;
    prefetchedKeyRef.current = key;

    const base = `/room/${roomCode}`;
    const predictionsHref =
      bootHint.gameState === "REVEAL" ? `${base}/minigame/reveal` : `${base}/minigame`;
    const routes = [
      `${base}`,
      `${base}/fixtures`,
      predictionsHref,
      `${base}/leaderboard`,
      `${base}/stats`,
    ];
    routes.forEach((href) => {
      void router.prefetch(href);
    });
  }, [bootHint, roomCode, router]);

  const accent = ACCENT_THEME[accentKey] || ACCENT_THEME.teal;
  const hideBottomNav =
    pathname === `/room/${roomCode}/minigame/play` ||
    pathname === `/room/${roomCode}/minigame/golden`;

  // Capture default app vars once, restore only when leaving room scope.
  useEffect(() => {
    const root = document.documentElement;
    initialVarsRef.current = {
      bg: root.style.getPropertyValue("--app-bg"),
      solid: root.style.getPropertyValue("--app-solid"),
    };
    return () => {
      const initial = initialVarsRef.current;
      if (!initial) return;
      if (initial.bg) root.style.setProperty("--app-bg", initial.bg);
      else root.style.removeProperty("--app-bg");
      if (initial.solid) root.style.setProperty("--app-solid", initial.solid);
      else root.style.removeProperty("--app-solid");
    };
  }, []);

  // Update vars on room/theme changes without resetting between room switches.
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    const applyBg = () => {
      root.style.setProperty("--app-bg", prefersDark.matches ? accent.bgDark : accent.bgLight);
      root.style.setProperty("--app-solid", prefersDark.matches ? accent.solidDark : accent.solidLight);
    };

    applyBg();
    prefersDark.addEventListener("change", applyBg);
    return () => {
      prefersDark.removeEventListener("change", applyBg);
    };
  }, [accent.bgDark, accent.bgLight, accent.solidDark, accent.solidLight]);

  return (
    <div
      className={hideBottomNav ? "room-theme" : "room-theme room-has-bottom-nav"}
      style={
        {
          "--room-accent": accent.hex,
          "--room-accent-rgb": accent.rgb,
          "--accent": accent.hex,
          "--shadow-card": `0 10px 30px rgba(${accent.rgb}, 0.20)`,
        } as React.CSSProperties
      }
    >
      {showBootOverlay ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="rounded-xl border border-subtle bg-surface px-4 py-3 text-sm text-foreground shadow-card">
            Getting app ready...
          </div>
        </div>
      ) : null}
      {children}
      <RoomBottomNav />
      <ScrollToTopButton />
    </div>
  );
}
