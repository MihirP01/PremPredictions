"use client";

import React from "react";
import { triggerTapHaptic } from "@/lib/haptics";

type ModalExitButtonProps = {
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
};

export default function ModalExitButton({
  onClick,
  ariaLabel = "Exit",
  className = "",
}: ModalExitButtonProps) {
  return (
    <button
      onClick={() => {
        triggerTapHaptic();
        onClick();
      }}
      className={[
        "h-9 rounded-lg border border-teal-500 bg-surface px-3 text-foreground",
        "hover:bg-surface-2 inline-flex items-center justify-center",
        className,
      ].join(" ")}
      aria-label={ariaLabel}
    >
      Exit
    </button>
  );
}
