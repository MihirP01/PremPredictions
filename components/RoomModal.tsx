"use client";

import React from "react";
import AnimatedModal from "./AnimatedModal";
import ModalExitButton from "./ModalExitButton";

type ThemedModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
};

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

type ModalHeaderProps = {
  title: string;
  onClose: () => void;
  ariaLabel?: string;
};

export function ModalHeader({ title, onClose, ariaLabel }: ModalHeaderProps) {
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
      <ModalExitButton
        onClick={onClose}
        ariaLabel={ariaLabel || `Exit ${title.toLowerCase()}`}
      />
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
