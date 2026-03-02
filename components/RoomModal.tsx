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
  maxWidthClassName = "max-w-md",
  panelClassName = "",
}: ThemedModalProps) {
  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      portal
      lockBackground
      zIndexClassName="z-[90]"
      overlayClassName="bg-[rgba(4,12,24,0.62)] backdrop-blur-sm"
      panelClassName={`w-full ${maxWidthClassName} rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,24,0.98),rgba(10,18,32,0.96))] p-4 shadow-[0_24px_56px_rgba(3,8,20,0.4)] ${panelClassName}`.trim()}
    >
      {children}
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
        <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/45">Room Controls</div>
        <div className="font-display text-lg font-semibold text-foreground">{title}</div>
      </div>
      <ModalExitButton onClick={onClose} ariaLabel={ariaLabel || `Exit ${title.toLowerCase()}`} />
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
      <div className="space-y-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
        <div className="font-display text-lg font-semibold text-foreground">{title}</div>
        <div className="text-sm text-muted">{body}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onClose}
          disabled={confirming}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground transition hover:border-white/16 hover:bg-white/[0.06] disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className={[
            "rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60",
            danger ? "bg-rose-500 text-white" : "bg-accent text-accent-foreground",
          ].join(" ")}
        >
          {confirming ? `${confirmLabel}...` : confirmLabel}
        </button>
      </div>
    </ThemedModal>
  );
}
