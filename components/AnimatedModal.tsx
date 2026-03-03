"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
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
  overlayStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
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
  overlayStyle,
  panelStyle,
  children,
}: AnimatedModalProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }
    const timer = window.setTimeout(() => setShouldRender(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !lockBackground || typeof document === "undefined") return;

    const scrollY = window.scrollY;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyLeft = document.body.style.left;
    const prevBodyRight = document.body.style.right;
    const prevBodyWidth = document.body.style.width;
    const prevBodyTouchAction = document.body.style.touchAction;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;

    // iOS-safe background lock: fix body in place and preserve current scroll offset
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.touchAction = "none";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    const blockBackgroundScroll = (event: TouchEvent | WheelEvent) => {
      const target = event.target as Element | null;
      if (!target) {
        event.preventDefault();
        return;
      }
      // Allow scrolling inside modal content only.
      if (target.closest("[data-modal-panel='true']")) return;
      event.preventDefault();
    };
    document.addEventListener("touchmove", blockBackgroundScroll, { passive: false });
    document.addEventListener("wheel", blockBackgroundScroll, { passive: false });

    return () => {
      document.removeEventListener("touchmove", blockBackgroundScroll);
      document.removeEventListener("wheel", blockBackgroundScroll);
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.left = prevBodyLeft;
      document.body.style.right = prevBodyRight;
      document.body.style.width = prevBodyWidth;
      document.body.style.touchAction = prevBodyTouchAction;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      window.scrollTo(0, scrollY);
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
      style={{ ...modalThemeStyle, ...overlayStyle }}
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target !== e.currentTarget) return;
        onClose?.();
      }}
      aria-hidden={!open}
    >
      <div
        data-modal-panel="true"
        className={[
          "transition-all duration-200 ease-out",
          open ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-1.5 scale-[0.985]",
          panelClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        style={panelStyle}
      >
        {children}
      </div>
    </div>
  );

  if (!shouldRender) return null;
  if (!portal) return modalNode;
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(modalNode, document.body);
}
