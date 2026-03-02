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
        "hidden h-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition duration-150 hover:border-white/20 hover:bg-black/30 sm:inline-flex",
        "page-action-btn whitespace-nowrap",
        className,
      ].join(" ")}
      data-action="back"
    >
      {label}
    </button>
  );
}
