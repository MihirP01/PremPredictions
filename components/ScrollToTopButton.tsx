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
        "scroll-top-fab fixed right-4 z-[86] inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-[22px] text-white transform-gpu",
        visible
          ? "scroll-top-fab--visible pointer-events-auto"
          : "scroll-top-fab--hidden pointer-events-none",
      ].join(" ")}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="scroll-top-fab__icon h-5 w-5"
        aria-hidden="true"
      >
        <path d="m18 14-6-6-6 6" />
      </svg>
    </button>
  );
}
