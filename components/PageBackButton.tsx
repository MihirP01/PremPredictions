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
        "h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500",
        "text-foreground hover:bg-surface-2 whitespace-nowrap hidden sm:inline-flex",
        "items-center justify-center page-action-btn",
        className,
      ].join(" ")}
      data-action="back"
    >
      {label}
    </button>
  );
}
