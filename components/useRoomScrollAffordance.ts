"use client";

import { useEffect, useState } from "react";

const SHOW_AFTER_PX = 220;
const HIDE_BELOW_PX = 160;
const COMPACT_AFTER_DOWN_PX = 36;
const EXPAND_AFTER_UP_PX = 52;

type ScrollAffordanceState = {
  visible: boolean;
  compact: boolean;
  cycle: number;
};

export default function useRoomScrollAffordance(resetKey?: unknown) {
  const [state, setState] = useState<ScrollAffordanceState>({
    visible: false,
    compact: false,
    cycle: 0,
  });

  useEffect(() => {
    let raf = 0;
    let lastScrollTop = 0;
    let upwardTravel = 0;
    let downwardTravel = 0;
    const getScrollRoot = () =>
      (document.getElementById("room-scroll-root") as HTMLElement | null) || null;

    const readScrollTop = () => {
      const scrollRoot = getScrollRoot();
      return scrollRoot
        ? scrollRoot.scrollTop
        : window.scrollY || document.documentElement.scrollTop || 0;
    };

    const updateVisibility = () => {
      raf = 0;
      const scrollRoot = getScrollRoot();
      const scrollTop = readScrollTop();
      const canScroll = scrollRoot
        ? scrollRoot.scrollHeight > scrollRoot.clientHeight + 32
        : document.documentElement.scrollHeight > window.innerHeight + 32;
      const delta = scrollTop - lastScrollTop;
      lastScrollTop = scrollTop;

      let compactPulse = false;
      let expand = false;
      if (delta > 0.5) {
        downwardTravel += delta;
        upwardTravel = 0;
        if (
          scrollTop > SHOW_AFTER_PX &&
          downwardTravel >= COMPACT_AFTER_DOWN_PX
        ) {
          compactPulse = true;
          downwardTravel = 0;
        }
      } else if (delta < -0.5) {
        upwardTravel += -delta;
        downwardTravel = 0;
        if (upwardTravel >= EXPAND_AFTER_UP_PX) {
          expand = true;
          upwardTravel = 0;
        }
      }

      setState((prev) => {
        if (!canScroll) {
          return prev.visible || prev.compact
            ? { ...prev, visible: false, compact: false }
            : prev;
        }

        const visible =
          scrollTop > SHOW_AFTER_PX
            ? true
            : scrollTop < HIDE_BELOW_PX
              ? false
              : prev.visible;
        const compact =
          scrollTop < HIDE_BELOW_PX
            ? false
            : expand
              ? false
              : compactPulse
                ? true
                : prev.compact;
        const cycle = compactPulse ? prev.cycle + 1 : prev.cycle;

        return visible === prev.visible &&
          compact === prev.compact &&
          cycle === prev.cycle
          ? prev
          : { visible, compact, cycle };
      });
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateVisibility);
    };

    lastScrollTop = readScrollTop();
    updateVisibility();
    const scrollRoot = getScrollRoot();
    if (scrollRoot) scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    else window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (scrollRoot) scrollRoot.removeEventListener("scroll", onScroll);
      else window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [resetKey]);

  return state;
}
