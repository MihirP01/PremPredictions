"use client";

import React, { useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Gamepad2, House, Trophy } from "lucide-react";

type NavItem = {
  key: "fixtures" | "predictions" | "home" | "leaderboard" | "stats";
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
};

export default function RoomBottomNav() {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const roomCode = String(params?.roomCode || "").toUpperCase();
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
  if (!roomCode) return null;

  const items: NavItem[] = [
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
      href: `/room/${roomCode}/minigame`,
      icon: Gamepad2,
      active:
        pathname === `/room/${roomCode}/minigame` ||
        pathname.startsWith(`/room/${roomCode}/minigame/`),
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
  ];

  const hideForActiveGamePhase =
    pathname === `/room/${roomCode}/minigame/play` ||
    pathname === `/room/${roomCode}/minigame/golden`;

  if (hideForActiveGamePhase) return null;

  return (
    <nav
      aria-label="Room navigation"
      className="room-bottom-nav sm:hidden bottom-nav-enter fixed inset-x-0 mx-auto z-40 w-[min(95vw,520px)] rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.62)] bg-surface/95 p-1.5 shadow-card backdrop-blur-md"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => router.push(item.href)}
              className={[
                "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-all duration-200",
                item.active
                  ? "scale-[1.05] border border-[color:rgba(var(--room-accent-rgb),0.72)] bg-[color:rgba(var(--room-accent-rgb),0.18)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.2)]"
                  : "border border-transparent bg-surface-2/70 text-muted",
              ].join(" ")}
            >
              <span className="nav-icon-wrap relative inline-flex h-4 w-4 items-center justify-center">
                <Icon
                  size={14}
                  style={
                    item.key === "home" && item.active
                      ? { color: "rgb(var(--room-accent-rgb))" }
                      : undefined
                  }
                  className={[
                    item.active ? "text-foreground" : "text-muted",
                    item.key === "fixtures" ? "nav-icon-fixtures-fix" : "",
                    item.key === "predictions" ? "nav-icon-predictions-fix" : "",
                    item.key === "home" ? "nav-icon-home-fix" : "",
                    item.key === "stats" ? "nav-icon-stats-fix" : "",
                    (item.key === "fixtures" ||
                      item.key === "predictions" ||
                      item.key === "home" ||
                      item.key === "stats") &&
                    item.active
                      ? "nav-icon-pulse"
                      : "",
                    item.key === "fixtures" && item.active ? "fixtures-icon--active" : "",
                    item.key === "predictions" && item.active ? "predictions-icon--active" : "",
                    item.key === "home" && item.active ? "home-icon--active" : "",
                    item.key === "stats" && item.active ? "stats-icon--active" : "",
                    item.key === "leaderboard" && item.active ? "leaderboard-icon--active" : "",
                  ].join(" ")}
                />
                {item.key === "predictions" && item.active ? (
                  <>
                    <span className="predictions-dot predictions-dot--left" />
                    <span className="predictions-dot predictions-dot--right" />
                  </>
                ) : null}
                {item.key === "leaderboard" && item.active ? (
                  <>
                    {leaderboardSparks.map((spark, idx) => (
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
              <span className="font-display text-[7.5px] leading-none truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
