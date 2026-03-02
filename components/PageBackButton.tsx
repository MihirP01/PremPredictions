"use client";

import React from "react";
import { triggerTapHaptic } from "@/lib/haptics";

type PageBackButtonProps = {
  onClick: () => void;
  label?: string;
  className?: string;
};

export default function PageBackButton({
  onClick,
  label = "Back",
  className = "",
}: PageBackButtonProps) {
  return (
    <button
      onClick={() => {
        triggerTapHaptic();
        onClick();
      }}
      className={[
        "page-action-btn hidden h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.18)] transition hover:border-white/16 hover:bg-white/[0.06] sm:inline-flex",
        "whitespace-nowrap",
        className,
      ].join(" ")}
      data-action="back"
    >
      {label}
    </button>
  );
}

(PageBackButton as typeof PageBackButton & { hidesOnMobile?: boolean }).hidesOnMobile = true;
