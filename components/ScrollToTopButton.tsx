"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { triggerTapHaptic } from "@/lib/haptics";
import useRoomScrollAffordance from "./useRoomScrollAffordance";

export default function ScrollToTopButton() {
  const pathname = usePathname();
  const { visible } = useRoomScrollAffordance(pathname);

  const scrollToTop = () => {
    triggerTapHaptic();
    const scrollRoot = document.getElementById("room-scroll-root");
    if (scrollRoot instanceof HTMLElement) {
      scrollRoot.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Return to top"
      className={[
        "scroll-top-fab no-3d fixed right-4 z-[86] inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-[22px] border text-foreground transform-gpu",
        visible
          ? "scroll-top-fab--visible pointer-events-auto"
          : "scroll-top-fab--hidden pointer-events-none",
      ].join(" ")}
      style={{
        borderColor: "rgba(255,255,255,0.1)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.052) 0%, rgba(255,255,255,0.025) 100%)",
        boxShadow:
          "0 16px 34px rgba(3,8,20,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px) saturate(170%)",
        WebkitBackdropFilter: "blur(20px) saturate(170%)",
        willChange: "opacity, transform",
        contain: "paint",
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-3 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)",
        }}
      />
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
