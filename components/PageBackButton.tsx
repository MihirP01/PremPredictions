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
        "hidden h-10 items-center justify-center whitespace-nowrap rounded-xl border border-white/8 bg-white/[0.03] px-4 text-sm font-medium text-foreground sm:inline-flex",
        "hover:border-[color:rgba(var(--room-accent-rgb),0.4)] hover:bg-white/[0.06]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
        "items-center justify-center page-action-btn",
        className,
      ].join(" ")}
      data-action="back"
    >
      {label}
    </button>
  );
}
