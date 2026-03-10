"use client";

import { useEffect, useState } from "react";

const SHOW_AFTER_PX = 220;
const HIDE_BELOW_PX = 160;

export default function useRoomScrollAffordance(resetKey?: unknown) {
  const [state, setState] = useState({ visible: false, cycle: 0 });

  useEffect(() => {
    let raf = 0;
    const getScrollRoot = () =>
      (document.getElementById("room-scroll-root") as HTMLElement | null) || null;

    const updateVisibility = () => {
      raf = 0;
      const scrollRoot = getScrollRoot();
      const scrollTop = scrollRoot
        ? scrollRoot.scrollTop
        : window.scrollY || document.documentElement.scrollTop || 0;
      const canScroll = scrollRoot
        ? scrollRoot.scrollHeight > scrollRoot.clientHeight + 32
        : document.documentElement.scrollHeight > window.innerHeight + 32;

      setState((prev) => {
        if (!canScroll) {
          return prev.visible ? { ...prev, visible: false } : prev;
        }
        if (!prev.visible && scrollTop > SHOW_AFTER_PX) {
          return { visible: true, cycle: prev.cycle + 1 };
        }
        if (prev.visible && scrollTop < HIDE_BELOW_PX) {
          return { ...prev, visible: false };
        }
        return prev;
      });
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateVisibility);
    };

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
