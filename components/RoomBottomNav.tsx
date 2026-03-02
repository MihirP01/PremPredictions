"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Gamepad2, House, Trophy } from "lucide-react";
import {
  getRoomBootstrapCached,
  peekRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
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
  const [mounted, setMounted] = useState(false);
  const [predictionsHref, setPredictionsHref] = useState<string>("");
  const [predictionsDisabled, setPredictionsDisabled] = useState(false);
  const lastTouchHandledAtRef = useRef(0);
  const [navFxTick, setNavFxTick] = useState<Record<NavItem["key"], number>>({
    fixtures: 0,
    predictions: 0,
    home: 0,
    leaderboard: 0,
    stats: 0,
    });

  useEffect(() => {
    setMounted(true);
  }, []);

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
            const state = String((snap as { state?: string } | null)?.state || "")
              .trim()
              .toUpperCase();

            if (state === "REVEAL") {
              setPredictionsHref(`/room/${roomCode}/minigame/reveal`);
              setPredictionsDisabled(false);
              return;
            }
            if (state === "DRAFT" || state === "GOLDEN" || state === "POWERUPS") {
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
    String(state || "").trim().toUpperCase() === "REVEAL"
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

  const onNavClick = (key: NavItem["key"], href: string, active: boolean, disabled?: boolean) => {
    setNavFxTick((prev) => ({ ...prev, [key]: prev[key] + 1 }));
    if (active || disabled) return;
    if (key === "predictions") {
      const cachedBootstrap = peekRoomBootstrapCached(roomCode);
      const immediateHref =
        predictionsHref ||
        predictionsRouteForState(cachedBootstrap?.gameState || "");
      router.push(immediateHref);
      if (!cachedBootstrap) syncPredictionsRoute(immediateHref);
      return;
    }
    router.push(href);
  };

  const onNavPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: NavItem,
  ) => {
    if (event.pointerType === "mouse") return;
    lastTouchHandledAtRef.current = Date.now();
    event.preventDefault();
    event.stopPropagation();
    onNavClick(item.key, item.href, item.active, item.disabled);
  };

  if (!mounted || !roomCode || hideForActiveGamePhase || typeof document === "undefined") {
    return null;
  }

  const navNode = (
    <nav
      aria-label="Room navigation"
      className="room-bottom-nav sm:hidden bottom-nav-enter fixed inset-x-0 mx-auto z-[80] w-[min(95vw,520px)] rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.62)] bg-surface/95 p-2 shadow-[0_8px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm pointer-events-auto"
      style={{
        position: "fixed",
        bottom: "-0.8rem",
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        transform: "translateZ(0)",
      }}
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onPointerDown={(event) => onNavPointerDown(event, item)}
              onClick={() => {
                if (Date.now() - lastTouchHandledAtRef.current < 450) return;
                onNavClick(item.key, item.href, item.active, item.disabled);
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
                    item.key === "leaderboard" && (item.active || navFxTick.leaderboard > 0)
                      ? "leaderboard-icon-pop"
                      : "",
                    item.key === "fixtures" && (item.active || navFxTick.fixtures > 0) ? "fixtures-icon-pop" : "",
                    item.key === "predictions" && (item.active || navFxTick.predictions > 0)
                      ? "predictions-icon-pop"
                      : "",
                    item.key === "home" && (item.active || navFxTick.home > 0) ? "home-icon-pop" : "",
                    item.key === "stats" && (item.active || navFxTick.stats > 0) ? "stats-icon-pop" : "",
                  ].join(" ")}
                />
                {item.key === "leaderboard" && (item.active || navFxTick.leaderboard > 0) ? (
                  <>
                    <span
                      key={`lb-ring-${navFxTick.leaderboard}`}
                      className="leaderboard-burst-once"
                    />
                    {[
                      { x: -14, y: -10, d: "0ms" },
                      { x: 13, y: -12, d: "60ms" },
                      { x: 16, y: 2, d: "100ms" },
                      { x: -15, y: 4, d: "140ms" },
                      { x: 0, y: -16, d: "40ms" },
                    ].map((spark, idx) => (
                      <span
                        key={`lb-spark-${navFxTick.leaderboard}-${idx}`}
                        className="leaderboard-firework-once"
                        style={
                          {
                            "--sx": `${spark.x}px`,
                            "--sy": `${spark.y}px`,
                            animationDelay: spark.d,
                          } as React.CSSProperties
                        }
                      />
                    ))}
                  </>
                ) : null}
                {item.key === "fixtures" && (item.active || navFxTick.fixtures > 0) ? (
                  <span key={`fx-wave-${navFxTick.fixtures}`} className="fixtures-wave-once" />
                ) : null}
                {item.key === "predictions" && (item.active || navFxTick.predictions > 0) ? (
                  <>
                    <span key={`pr-dot-l-${navFxTick.predictions}`} className="predictions-dot-once predictions-dot-once--left" />
                    <span key={`pr-dot-r-${navFxTick.predictions}`} className="predictions-dot-once predictions-dot-once--right" />
                  </>
                ) : null}
                {item.key === "home" && (item.active || navFxTick.home > 0) ? (
                  <span key={`home-ring-${navFxTick.home}`} className="home-ring-once" />
                ) : null}
                {item.key === "stats" && (item.active || navFxTick.stats > 0) ? (
                  <>
                    <span key={`st-bar-1-${navFxTick.stats}`} className="stats-bar-once stats-bar-once--1" />
                    <span key={`st-bar-2-${navFxTick.stats}`} className="stats-bar-once stats-bar-once--2" />
                    <span key={`st-bar-3-${navFxTick.stats}`} className="stats-bar-once stats-bar-once--3" />
                  </>
                ) : null}
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
