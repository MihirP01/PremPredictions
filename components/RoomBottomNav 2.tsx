"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Gamepad2, House, Trophy } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";

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
  const lastTapRef = useRef(0);
  const [predictionsHref, setPredictionsHref] = useState<string>("");
  const [predictionsDisabled, setPredictionsDisabled] = useState(false);
  const heavyFx = process.env.NODE_ENV !== "production";
  const sparkSeed = useMemo(() => {
    const source = `${roomCode}:${pathname}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    }
    return hash || 1;
  }, [roomCode, pathname]);

  const leaderboardSparks = useMemo(() => {
    const seed = sparkSeed || 1;
    const noise = (n: number) => {
      const x = Math.sin((seed + n) * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: 8 }, (_, idx) => {
      const angle = noise(idx + 1) * Math.PI * 2;
      const distance = 8 + noise(idx + 11) * 7;
      const sx = Math.cos(angle) * distance;
      const sy = Math.sin(angle) * distance;
      return {
        sx: `${sx.toFixed(1)}px`,
        sy: `${sy.toFixed(1)}px`,
        delayMs: Math.round(noise(idx + 21) * 700),
        durationMs: 740 + Math.round(noise(idx + 31) * 420),
        sizePx: 2 + Math.round(noise(idx + 41) * 1),
      };
    });
  }, [sparkSeed]);

  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      try {
        const current = await getCurrentGameweekCached();
        if (cancelled) return;
        const seasonKey = String(current?.seasonKey || "");
        const gw = Number(current?.currentGameweek || 1);
        if (!seasonKey || !Number.isFinite(gw)) {
          setPredictionsHref(`/room/${roomCode}/minigame`);
          setPredictionsDisabled(false);
          return;
        }

        const gameRef = doc(
          db,
          "rooms",
          roomCode,
          "seasons",
          seasonKey,
          "games",
          `gw-${gw}`,
        );

        unsub = onSnapshot(
          gameRef,
          (snap) => {
            const state = String(
              (snap.data() as { state?: string } | undefined)?.state || "",
            )
              .trim()
              .toUpperCase();

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
        disabled: predictionsDisabled,
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
    [pathname, roomCode, predictionsDisabled, predictionsHref],
  );

  const hideForActiveGamePhase =
    pathname === `/room/${roomCode}/minigame/play` ||
    pathname === `/room/${roomCode}/minigame/golden` ||
    pathname === `/room/${roomCode}/minigame/powerups`;

  useEffect(() => {
    items.forEach((item) => router.prefetch(item.href));
  }, [items, router]);

  useEffect(() => {
    return () => {
      if (lastTapRef.current) {
        window.clearTimeout(lastTapRef.current);
        lastTapRef.current = 0;
      }
    };
  }, []);

  const onNavClick = (href: string, active: boolean, disabled?: boolean) => {
    if (active || disabled) return;
    if (lastTapRef.current) return;
    lastTapRef.current = window.setTimeout(() => {
      lastTapRef.current = 0;
    }, 250) as unknown as number;
    router.push(href);
  };

  if (!roomCode || hideForActiveGamePhase) return null;

  return (
    <nav
      aria-label="Room navigation"
      className="room-bottom-nav sm:hidden bottom-nav-enter fixed inset-x-0 mx-auto z-40 w-[min(95vw,520px)] rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.62)] bg-surface/95 p-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavClick(item.href, item.active, item.disabled)}
              disabled={item.disabled}
              aria-disabled={item.disabled ? "true" : undefined}
              className={[
                "flex min-w-0 min-h-[44px] [touch-action:manipulation] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-all duration-150",
                item.active
                  ? "scale-[1.05] border border-[color:rgba(var(--room-accent-rgb),0.72)] bg-[color:rgba(var(--room-accent-rgb),0.18)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.2)]"
                  : item.disabled
                    ? "border border-transparent bg-surface-2/50 text-muted opacity-55 cursor-not-allowed"
                    : "border border-transparent bg-surface-2/70 text-muted",
              ].join(" ")}
            >
              <span className="nav-icon-wrap relative inline-flex h-4 w-4 items-center justify-center">
                <Icon
                  size={14}
                  className={[
                    item.active ? "text-foreground" : "text-muted",
                    item.key === "fixtures" ? "nav-icon-fixtures-fix" : "",
                    item.key === "predictions"
                      ? "nav-icon-predictions-fix"
                      : "",
                    item.key === "home" ? "nav-icon-home-fix" : "",
                    item.key === "home" && item.active
                      ? "hub-icon-active-theme"
                      : "",
                    item.key === "stats" ? "nav-icon-stats-fix" : "",
                    (item.key === "fixtures" ||
                      item.key === "predictions" ||
                      item.key === "home" ||
                      item.key === "stats") &&
                    item.active &&
                    heavyFx
                      ? "nav-icon-pulse"
                      : "",
                    item.key === "fixtures" && item.active && heavyFx
                      ? "fixtures-icon--active"
                      : "",
                    item.key === "predictions" && item.active && heavyFx
                      ? "predictions-icon--active"
                      : "",
                    item.key === "home" && item.active
                      ? "home-icon--active"
                      : "",
                    item.key === "stats" && item.active
                      ? "stats-icon--active"
                      : "",
                    item.key === "leaderboard" && item.active && heavyFx
                      ? "leaderboard-icon--active"
                      : "",
                  ].join(" ")}
                />
                {item.key === "predictions" && item.active && heavyFx ? (
                  <>
                    <span className="predictions-dot predictions-dot--left" />
                    <span className="predictions-dot predictions-dot--right" />
                  </>
                ) : null}
                {item.key === "leaderboard" && item.active ? (
                  <>
                    {heavyFx &&
                      leaderboardSparks.map((spark, idx) => (
                        <span
                          key={`spark-${idx}`}
                          className="leaderboard-firework"
                          style={{
                            ["--sx" as string]: spark.sx,
                            ["--sy" as string]: spark.sy,
                            animationDelay: `${spark.delayMs}ms`,
                            animationDuration: `${spark.durationMs}ms`,
                            width: `${spark.sizePx}px`,
                            height: `${spark.sizePx}px`,
                          }}
                        />
                      ))}
                  </>
                ) : null}
              </span>
              <span className="font-display text-[7.5px] leading-none truncate">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
