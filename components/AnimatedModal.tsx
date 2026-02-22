"use client";

import React, { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type AnimatedModalProps = {
  open: boolean;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  portal?: boolean;
  lockBackground?: boolean;
  zIndexClassName?: string;
  overlayClassName?: string;
  panelClassName?: string;
  children: React.ReactNode;
};

export default function AnimatedModal({
  open,
  onClose,
  closeOnBackdrop = false,
  portal = false,
  lockBackground = false,
  zIndexClassName = "z-[90]",
  overlayClassName = "",
  panelClassName = "",
  children,
}: AnimatedModalProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open || !lockBackground || typeof document === "undefined") return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.touchAction = prevBodyTouchAction;
    };
  }, [open, lockBackground]);

  let modalThemeStyle: React.CSSProperties | undefined;
  if (mounted && typeof document !== "undefined") {
    const themeRoot = document.querySelector(".room-theme") as HTMLElement | null;
    if (themeRoot) {
      const computed = window.getComputedStyle(themeRoot);
      const accent = computed.getPropertyValue("--room-accent").trim();
      const accentRgb = computed.getPropertyValue("--room-accent-rgb").trim();
      modalThemeStyle = {
        ["--room-accent" as string]: accent || "#2dd4bf",
        ["--room-accent-rgb" as string]: accentRgb || "45,212,191",
      };
    }
  }

  const modalNode = (
    <div
      className={[
        "room-theme fixed inset-0 flex items-center justify-center p-4 transition-opacity duration-200",
        open ? "opacity-100" : "opacity-0 pointer-events-none",
        zIndexClassName,
        overlayClassName,
      ]
        .filter(Boolean)
        .join(" ")}
      style={modalThemeStyle}
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target !== e.currentTarget) return;
        onClose?.();
      }}
      aria-hidden={!open}
    >
      <div
        className={[
          "transition-all duration-200 ease-out",
          open ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-1.5 scale-[0.985]",
          panelClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </div>
  );

  if (!portal) return modalNode;
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(modalNode, document.body);
}
