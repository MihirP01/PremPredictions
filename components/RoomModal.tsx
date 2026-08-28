"use client";

import React, { useEffect, useRef, useState } from "react";
import AnimatedModal from "./AnimatedModal";
import ModalExitButton from "./ModalExitButton";

type ThemedModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
};

type ThemedSheetModalProps = ThemedModalProps & {
  bodyClassName?: string;
  showHandle?: boolean;
  initialSnap?: "collapsed" | "expanded";
};

const SHEET_COLLAPSED_RATIO = 2 / 5;
const SHEET_EXPANDED_RATIO = 0.9;
const SHEET_MIN_DRAG_HEIGHT = 72;
const SHEET_CLOSE_FROM_EXPANDED_FACTOR = 0.55;

export function ThemedModal({
  open,
  onClose,
  children,
  maxWidthClassName = "max-w-lg",
  panelClassName = "",
}: ThemedModalProps) {
  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      portal
      lockBackground
      zIndexClassName="z-[90]"
      overlayClassName="backdrop-blur-sm"
      panelClassName={`w-full ${maxWidthClassName} max-h-[88dvh] overflow-y-auto overscroll-contain rounded-[24px] border p-4 sm:p-5 no-scrollbar ${panelClassName}`.trim()}
      overlayStyle={{ background: "var(--editorial-modal-overlay)" }}
      panelStyle={{
        borderColor: "var(--editorial-modal-border)",
        background: "var(--editorial-modal-bg)",
        boxShadow: "0 28px 68px rgba(3,8,20,0.42)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
      }}
    >
      <div className="flex flex-col gap-4 sm:gap-5">{children}</div>
    </AnimatedModal>
  );
}

export function ThemedSheetModal({
  open,
  onClose,
  children,
  maxWidthClassName = "max-w-3xl",
  panelClassName = "",
  bodyClassName = "",
  showHandle = true,
  initialSnap = "collapsed",
}: ThemedSheetModalProps) {
  const [sheetSnap, setSheetSnap] = useState<"collapsed" | "expanded">(
    initialSnap,
  );
  const [isMobile, setIsMobile] = useState(false);
  const [sheetHeightPx, setSheetHeightPx] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartHeightRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const liveHeightRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      dragStartYRef.current = null;
      dragStartHeightRef.current = null;
      dragMovedRef.current = false;
      const timer = window.setTimeout(() => {
        setSheetSnap("collapsed");
        setSheetHeightPx(null);
        liveHeightRef.current = null;
        setDragging(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setSheetSnap(initialSnap);
      const nextHeight = Math.round(
        window.innerHeight *
          (initialSnap === "expanded"
            ? SHEET_EXPANDED_RATIO
            : SHEET_COLLAPSED_RATIO),
      );
      setSheetHeightPx(nextHeight);
      liveHeightRef.current = nextHeight;
      setDragging(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, initialSnap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 639px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;
    const onResize = () => {
      const ratio =
        sheetSnap === "expanded"
          ? SHEET_EXPANDED_RATIO
          : SHEET_COLLAPSED_RATIO;
      const nextHeight = Math.round(window.innerHeight * ratio);
      setSheetHeightPx(nextHeight);
      liveHeightRef.current = nextHeight;
      if (panelRef.current) panelRef.current.style.height = `${nextHeight}px`;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, isMobile, sheetSnap]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function collapseHeightPx() {
    return Math.round(window.innerHeight * SHEET_COLLAPSED_RATIO);
  }

  function expandedHeightPx() {
    return Math.round(window.innerHeight * SHEET_EXPANDED_RATIO);
  }

  function beginDrag(clientY: number) {
    dragStartYRef.current = clientY;
    const startHeight =
      sheetHeightPx ??
      (sheetSnap === "expanded" ? expandedHeightPx() : collapseHeightPx());
    dragStartHeightRef.current = startHeight;
    liveHeightRef.current = startHeight;
    dragMovedRef.current = false;
    setDragging(true);
    if (panelRef.current) {
      panelRef.current.style.transition = "none";
      panelRef.current.style.height = `${startHeight}px`;
    }
  }

  function updateDrag(clientY: number) {
    const startY = dragStartYRef.current;
    const startHeight = dragStartHeightRef.current;
    if (startY == null || startHeight == null) return;
    const deltaY = clientY - startY;
    if (Math.abs(deltaY) > 6) dragMovedRef.current = true;
    const nextHeight = Math.round(
      Math.max(SHEET_MIN_DRAG_HEIGHT, Math.min(expandedHeightPx(), startHeight - deltaY)),
    );
    liveHeightRef.current = nextHeight;
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      if (panelRef.current && liveHeightRef.current != null) {
        panelRef.current.style.height = `${liveHeightRef.current}px`;
      }
    });
  }

  function endDrag() {
    const startY = dragStartYRef.current;
    const startHeight =
      dragStartHeightRef.current ??
      (sheetSnap === "expanded" ? expandedHeightPx() : collapseHeightPx());
    dragStartYRef.current = null;
    dragStartHeightRef.current = null;
    if (startY == null) {
      setDragging(false);
      return;
    }
    if (panelRef.current) {
      panelRef.current.style.transition = "";
    }
    const releasedHeight =
      liveHeightRef.current ??
      sheetHeightPx ??
      (sheetSnap === "expanded" ? expandedHeightPx() : collapseHeightPx());
    const movedEnough = dragMovedRef.current;
    dragMovedRef.current = false;
    setDragging(false);
    if (!movedEnough) {
      const nextSnap = sheetSnap === "expanded" ? "collapsed" : "expanded";
      const nextHeight =
        nextSnap === "expanded" ? expandedHeightPx() : collapseHeightPx();
      setSheetSnap(nextSnap);
      setSheetHeightPx(nextHeight);
      liveHeightRef.current = nextHeight;
      return;
    }
    const collapsedHeight = collapseHeightPx();
    const expandedHeight = expandedHeightPx();

    if (sheetSnap === "collapsed") {
      if (releasedHeight > startHeight) {
        setSheetSnap("expanded");
        setSheetHeightPx(expandedHeight);
        liveHeightRef.current = expandedHeight;
      } else {
        onClose();
      }
      return;
    }

    if (releasedHeight >= startHeight) {
      setSheetSnap("expanded");
      setSheetHeightPx(expandedHeight);
      liveHeightRef.current = expandedHeight;
      return;
    }

    if (releasedHeight <= collapsedHeight * SHEET_CLOSE_FROM_EXPANDED_FACTOR) {
      onClose();
      return;
    }

    setSheetSnap("collapsed");
    setSheetHeightPx(collapsedHeight);
    liveHeightRef.current = collapsedHeight;
  }

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      portal
      lockBackground
      zIndexClassName="z-[90]"
      overlayClassName="items-end px-0 pb-0 pt-4 sm:items-center sm:p-4"
      overlayOpenClassName="backdrop-blur-md"
      overlayClosedClassName="backdrop-blur-0"
      panelOpenClassName="opacity-100 translate-y-0 scale-100"
      panelClosedClassName="opacity-0 translate-y-full sm:translate-y-3 sm:scale-[0.985]"
      panelRef={panelRef}
      panelClassName={`flex ${maxWidthClassName} max-h-[92dvh] flex-col overflow-hidden overscroll-contain rounded-t-[28px] rounded-b-none border border-b-0 no-scrollbar sm:w-full sm:max-h-[88dvh] sm:rounded-[28px] sm:border-b ${panelClassName}`.trim()}
      overlayStyle={{ background: "var(--editorial-modal-overlay)" }}
      panelStyle={{
        borderColor: "var(--editorial-modal-border)",
        background: "var(--editorial-modal-bg)",
        boxShadow: "0 28px 68px rgba(3,8,20,0.42)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        transition: dragging
          ? "none"
          : "height 220ms cubic-bezier(0.22,1,0.36,1)",
        width: isMobile ? "calc(100% - 0.75rem)" : undefined,
        height: isMobile
          ? `${sheetHeightPx ?? collapseHeightPx()}px`
          : undefined,
      }}
    >
      {showHandle ? (
        <button
          type="button"
          aria-label={sheetSnap === "expanded" ? "Collapse sheet" : "Expand sheet"}
          onPointerDown={(event) => {
            if (!isMobile) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            beginDrag(event.clientY);
          }}
          onPointerMove={(event) => {
            if (!isMobile || dragStartYRef.current == null) return;
            event.preventDefault();
            updateDrag(event.clientY);
          }}
          onPointerUp={(event) => {
            if (!isMobile) return;
            event.preventDefault();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            endDrag();
          }}
          onPointerCancel={(event) => {
            if (!isMobile) return;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            endDrag();
          }}
          className="flex justify-center px-4 pb-2 pt-3 sm:hidden"
          style={{ touchAction: "none", WebkitTapHighlightColor: "transparent" }}
        >
          <div className="flex h-6 w-16 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
            <div className="h-1.5 w-11 rounded-full bg-white/14" />
          </div>
        </button>
      ) : null}
      <div
        ref={bodyRef}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 sm:px-5 sm:pb-5 sm:pt-4 ${bodyClassName}`.trim()}
        style={{
          paddingBottom: isMobile ? "calc(env(safe-area-inset-bottom) + 1rem)" : undefined,
        }}
      >
        <div className="flex flex-col gap-4 sm:gap-5">{children}</div>
      </div>
    </AnimatedModal>
  );
}

type ModalHeaderProps = {
  title: string;
  onClose?: () => void;
  ariaLabel?: string;
  showCloseButton?: boolean;
  closeButtonClassName?: string;
};

export function ModalHeader({
  title,
  onClose,
  ariaLabel,
  showCloseButton = true,
  closeButtonClassName = "",
}: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/45">
          Room Controls
        </div>
        <div className="font-display text-lg font-semibold text-foreground">
          {title}
        </div>
      </div>
      {showCloseButton && onClose ? (
        <ModalExitButton
          onClick={onClose}
          ariaLabel={ariaLabel || `Exit ${title.toLowerCase()}`}
          className={closeButtonClassName}
        />
      ) : null}
    </div>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  danger?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirming = false,
  danger = false,
}: ConfirmDialogProps) {
  return (
    <ThemedModal open={open} onClose={onClose} maxWidthClassName="max-w-sm">
      <div
        className="space-y-3 rounded-[22px] border p-4"
        style={{
          borderColor: "var(--editorial-action-border)",
          background: "var(--editorial-action-bg)",
        }}
      >
        <div className="font-display text-lg font-semibold text-foreground">
          {title}
        </div>
        <div className="text-sm text-muted">{body}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onClose}
          disabled={confirming}
          className="rounded-2xl border px-4 py-3 text-sm text-foreground transition disabled:opacity-60"
          style={{
            borderColor: "var(--editorial-action-border)",
            background: "var(--editorial-action-bg)",
          }}
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className={[
            "rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60",
            danger
              ? "bg-rose-500 text-white"
              : "bg-accent text-accent-foreground",
          ].join(" ")}
        >
          {confirming ? `${confirmLabel}...` : confirmLabel}
        </button>
      </div>
    </ThemedModal>
  );
}
