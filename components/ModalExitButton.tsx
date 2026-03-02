"use client";

import React, { useRef } from "react";
import { flushSync } from "react-dom";
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
  const lastTouchHandledAtRef = useRef(0);

  function handlePress() {
    triggerTapHaptic();
    flushSync(() => onClick());
  }

  return (
    <button
      type="button"
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        lastTouchHandledAtRef.current = Date.now();
        event.preventDefault();
        event.stopPropagation();
        handlePress();
      }}
      onClick={() => {
        if (Date.now() - lastTouchHandledAtRef.current < 450) return;
        handlePress();
      }}
      className={[
        "inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.18)] transition hover:border-white/16 hover:bg-white/[0.06]",
        className,
      ].join(" ")}
      aria-label={ariaLabel}
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
    >
      Exit
    </button>
  );
}
