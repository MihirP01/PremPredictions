"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { triggerTapHaptic } from "@/lib/haptics";

const SHOW_AFTER_PX = 220;
const HIDE_BELOW_PX = 160;

export default function ScrollToTopButton() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    const updateVisibility = () => {
      raf = 0;
      const scrollTop =
        window.scrollY || document.documentElement.scrollTop || 0;
      const canScroll =
        document.documentElement.scrollHeight > window.innerHeight + 32;
      setVisible((prev) => {
        if (!canScroll) return false;
        if (!prev && scrollTop > SHOW_AFTER_PX) return true;
        if (prev && scrollTop < HIDE_BELOW_PX) return false;
        return prev;
      });
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  const scrollToTop = () => {
    triggerTapHaptic();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Return to top"
      className={[
        "scroll-top-fab fixed right-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full",
        "border bg-surface text-foreground backdrop-blur-sm",
        "will-change-transform",
        visible ? "hover:scale-[1.02] active:scale-[0.98]" : "",
        visible
          ? "scroll-top-fab--visible pointer-events-auto"
          : "scroll-top-fab--hidden pointer-events-none",
      ].join(" ")}
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        borderColor: "rgba(var(--room-accent-rgb, 14,165,164), 1)",
        boxShadow:
          "0 8px 22px rgba(var(--room-accent-rgb, 14,165,164), 0.28)",
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path d="m18 14-6-6-6 6" />
      </svg>
    </button>
  );
}
