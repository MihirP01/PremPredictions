"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

let nextModalId = 1;
let modalStack: number[] = [];
const modalStackListeners = new Set<() => void>();

function emitModalStack() {
  for (const listener of modalStackListeners) listener();
}

function subscribeModalStack(listener: () => void) {
  modalStackListeners.add(listener);
  return () => modalStackListeners.delete(listener);
}

function getModalStackSnapshot() {
  return modalStack;
}

function pushModalToStack(id: number) {
  if (modalStack.includes(id)) return;
  modalStack = [...modalStack, id];
  emitModalStack();
  syncModalOpenClass();
}

function removeModalFromStack(id: number) {
  if (!modalStack.includes(id)) return;
  modalStack = modalStack.filter((entry) => entry !== id);
  emitModalStack();
  syncModalOpenClass();
}


function syncModalOpenClass() {
  if (typeof document === "undefined") return;
  const active = modalStack.length > 0;
  document.documentElement.classList.toggle("modal-open", active);
  document.body.classList.toggle("modal-open", active);
}

const bodyLockState = {
  count: 0,
  prevBodyOverflow: "",
  prevBodyTouchAction: "",
  prevHtmlOverflow: "",
  prevOverscroll: "",
  blockBackgroundScroll: null as ((event: TouchEvent | WheelEvent) => void) | null,
};

function acquireBodyLock() {
  if (typeof document === "undefined") return;
  bodyLockState.count += 1;
  if (bodyLockState.count > 1) return;

  bodyLockState.prevBodyOverflow = document.body.style.overflow;
  bodyLockState.prevBodyTouchAction = document.body.style.touchAction;
  bodyLockState.prevHtmlOverflow = document.documentElement.style.overflow;
  bodyLockState.prevOverscroll = document.documentElement.style.overscrollBehavior;

  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";
  document.documentElement.style.overflow = "hidden";
  document.documentElement.style.overscrollBehavior = "none";

  bodyLockState.blockBackgroundScroll = (event) => {
    const target = event.target as Element | null;
    if (!target) {
      event.preventDefault();
      return;
    }
    if (target.closest("[data-modal-panel='true']")) return;
    event.preventDefault();
  };

  document.addEventListener("touchmove", bodyLockState.blockBackgroundScroll, {
    passive: false,
  });
  document.addEventListener("wheel", bodyLockState.blockBackgroundScroll, {
    passive: false,
  });
}

function releaseBodyLock() {
  if (typeof document === "undefined" || bodyLockState.count === 0) return;
  bodyLockState.count -= 1;
  if (bodyLockState.count > 0) return;

  if (bodyLockState.blockBackgroundScroll) {
    document.removeEventListener("touchmove", bodyLockState.blockBackgroundScroll);
    document.removeEventListener("wheel", bodyLockState.blockBackgroundScroll);
    bodyLockState.blockBackgroundScroll = null;
  }

  document.body.style.overflow = bodyLockState.prevBodyOverflow;
  document.body.style.touchAction = bodyLockState.prevBodyTouchAction;
  document.documentElement.style.overflow = bodyLockState.prevHtmlOverflow;
  document.documentElement.style.overscrollBehavior = bodyLockState.prevOverscroll;
}

function parseBaseZIndex(zIndexClassName: string) {
  const bracketMatch = zIndexClassName.match(/z-\[(\d+)\]/);
  if (bracketMatch) return Number(bracketMatch[1]);
  const plainMatch = zIndexClassName.match(/(?:^|\s)z-(\d+)(?:\s|$)/);
  if (plainMatch) return Number(plainMatch[1]);
  return 90;
}

type AnimatedModalProps = {
  open: boolean;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  portal?: boolean;
  lockBackground?: boolean;
  zIndexClassName?: string;
  overlayClassName?: string;
  overlayOpenClassName?: string;
  overlayClosedClassName?: string;
  panelClassName?: string;
  panelOpenClassName?: string;
  panelClosedClassName?: string;
  panelRef?: React.Ref<HTMLDivElement>;
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
  overlayOpenClassName = "",
  overlayClosedClassName = "",
  panelClassName = "",
  panelOpenClassName = "opacity-100 translate-y-0 scale-100",
  panelClosedClassName = "opacity-0 translate-y-1.5 scale-[0.985]",
  panelRef,
  overlayStyle,
  panelStyle,
  children,
}: AnimatedModalProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const modalId = React.useRef<number>(nextModalId++);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const stack = useSyncExternalStore(
    subscribeModalStack,
    getModalStackSnapshot,
    () => [],
  );
  const stackIndex = stack.indexOf(modalId.current);
  const isTopModal = stackIndex === stack.length - 1;
  const computedZIndex = parseBaseZIndex(zIndexClassName) + Math.max(0, stackIndex) * 10;

  useEffect(() => {
    if (open) {
      let frameA = 0;
      let frameB = 0;
      const timer = window.setTimeout(() => {
        setIsVisible(false);
        setShouldRender(true);
        frameA = window.requestAnimationFrame(() => {
          frameB = window.requestAnimationFrame(() => {
            setIsVisible(true);
          });
        });
      }, 0);
      return () => {
        window.clearTimeout(timer);
        if (frameA) window.cancelAnimationFrame(frameA);
        if (frameB) window.cancelAnimationFrame(frameB);
      };
    }
    const hideTimer = window.setTimeout(() => setIsVisible(false), 0);
    const unmountTimer = window.setTimeout(() => setShouldRender(false), 320);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [open]);

  useEffect(() => {
    const id = modalId.current;
    if (!shouldRender) {
      removeModalFromStack(id);
      return;
    }
    pushModalToStack(id);
    return () => {
      removeModalFromStack(id);
    };
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !lockBackground || typeof document === "undefined") return;
    acquireBodyLock();
    return () => {
      releaseBodyLock();
    };
  }, [shouldRender, lockBackground]);

  useEffect(() => {
    if (!shouldRender || !isTopModal || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shouldRender, isTopModal, onClose]);

  let modalThemeStyle: React.CSSProperties | undefined;
  if (mounted && typeof document !== "undefined") {
    const themeRoot = document.querySelector(
      ".room-theme",
    ) as HTMLElement | null;
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
        "room-theme fixed inset-0 flex items-center justify-center p-4 transition-[opacity,backdrop-filter,-webkit-backdrop-filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none",
        isTopModal ? "" : "pointer-events-none",
        isVisible ? overlayOpenClassName : overlayClosedClassName,
        overlayClassName,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...modalThemeStyle, ...overlayStyle, zIndex: computedZIndex }}
      onMouseDown={(e) => {
        if (!closeOnBackdrop || !isTopModal) return;
        if (e.target !== e.currentTarget) return;
        onClose?.();
      }}
      aria-hidden={!isVisible || !isTopModal}
    >
      <div
        ref={panelRef}
        data-modal-panel="true"
        tabIndex={-1}
        role="dialog"
        aria-modal={isTopModal}
        className={[
          "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          isVisible ? panelOpenClassName : panelClosedClassName,
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
