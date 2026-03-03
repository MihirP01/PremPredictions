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
        "inline-flex h-10 items-center justify-center rounded-2xl border px-4 text-sm text-foreground shadow-[0_12px_26px_rgba(3,8,20,0.16)] transition",
        className,
      ].join(" ")}
      aria-label={ariaLabel}
      style={{
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        borderColor: "var(--editorial-action-border)",
        background: "var(--editorial-action-bg)",
      }}
    >
      Exit
    </button>
  );
}
