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
        "h-9 rounded-lg border border-teal-500 bg-surface px-3 text-foreground",
        "hover:bg-surface-2 inline-flex items-center justify-center",
        className,
      ].join(" ")}
      aria-label={ariaLabel}
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
    >
      Exit
    </button>
  );
}
