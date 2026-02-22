"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Gamepad2, House, Trophy } from "lucide-react";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { subscribeRoomGameDoc } from "@/lib/liveGameBus";

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
  const [predictionsHref, setPredictionsHref] = useState<string>("");
  const [predictionsDisabled, setPredictionsDisabled] = useState(false);

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

        if (bootstrapState === "REVEAL") {
          setPredictionsHref(`/room/${roomCode}/minigame/reveal`);
          setPredictionsDisabled(false);
        } else if (bootstrapState === "DRAFT" || bootstrapState === "GOLDEN") {
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
            const state = String((snap as { state?: string } | null)?.state || "")
              .trim()
              .toUpperCase();

            if (state === "REVEAL") {
              setPredictionsHref(`/room/${roomCode}/minigame/reveal`);
              setPredictionsDisabled(false);
              return;
            }
            if (state === "DRAFT" || state === "GOLDEN") {
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
    pathname === `/room/${roomCode}/minigame/golden`;

  useEffect(() => {
    items.forEach((item) => router.prefetch(item.href));
  }, [items, router]);

  const onNavClick = (href: string, active: boolean, disabled?: boolean) => {
    if (active || disabled) return;
    router.push(href);
  };

  const onNavPointerUp = (
    e: React.PointerEvent<HTMLButtonElement>,
    href: string,
    active: boolean,
    disabled?: boolean,
  ) => {
    // Make taps feel immediate on mobile Safari/PWA.
    e.preventDefault();
    onNavClick(href, active, disabled);
  };

  if (!roomCode || hideForActiveGamePhase || typeof document === "undefined") return null;

  const navNode = (
    <nav
      aria-label="Room navigation"
      className="room-bottom-nav sm:hidden bottom-nav-enter fixed left-1/2 z-[80] w-[min(95vw,520px)] -translate-x-1/2 rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.62)] bg-surface/95 p-2 shadow-[0_8px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm pointer-events-auto"
      style={{
        position: "fixed",
        bottom: "calc(env(safe-area-inset-bottom) + 0.5rem)",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onPointerUp={(e) =>
                onNavPointerUp(e, item.href, item.active, item.disabled)
              }
              onClick={(e) => {
                // Keep keyboard activation support (Enter/Space).
                if (e.detail === 0) onNavClick(item.href, item.active, item.disabled);
              }}
              disabled={item.disabled}
              aria-disabled={item.disabled ? "true" : undefined}
              className={[
                "flex min-w-0 min-h-[56px] touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 transition-all duration-150 pointer-events-auto",
                item.active
                  ? "scale-[1.05] border border-[color:rgba(var(--room-accent-rgb),0.72)] bg-[color:rgba(var(--room-accent-rgb),0.18)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.2)]"
                  : item.disabled
                    ? "border border-transparent bg-surface-2/50 text-muted opacity-55 cursor-not-allowed"
                    : "border border-transparent bg-surface-2/70 text-muted",
              ].join(" ")}
            >
              <span className="nav-icon-wrap relative inline-flex h-5 w-5 items-center justify-center">
                <Icon
                  size={16}
                  className={[
                    item.active ? "text-foreground" : "text-muted",
                    item.key === "fixtures" ? "nav-icon-fixtures-fix" : "",
                    item.key === "predictions" ? "nav-icon-predictions-fix" : "",
                    item.key === "home" ? "nav-icon-home-fix" : "",
                    item.key === "home" && item.active ? "hub-icon-active-theme" : "",
                    item.key === "stats" ? "nav-icon-stats-fix" : "",
                    item.key === "home" && item.active ? "home-icon--active" : "",
                    item.key === "stats" && item.active ? "stats-icon--active" : "",
                  ].join(" ")}
                />
              </span>
              <span className="font-display text-[8px] leading-none truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  return createPortal(navNode, document.body);
}
