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
      overlayClassName="bg-[radial-gradient(circle_at_top,rgba(244,114,182,0.15),transparent_35%),rgba(4,6,14,0.82)] backdrop-blur-md"
      panelClassName={`w-full ${maxWidthClassName} rounded-[28px] border border-white/10 bg-[linear-gradient(155deg,rgba(12,15,26,0.98),rgba(31,14,42,0.98)_55%,rgba(50,20,11,0.95))] p-4 shadow-[0_28px_90px_rgba(3,2,16,0.62)] ${panelClassName}`.trim()}
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
        <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/50">
          Control Panel
        </div>
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
      <div className="space-y-3 rounded-[22px] border border-white/8 bg-black/15 p-4">
        <div className="font-display text-xl font-semibold text-foreground">{title}</div>
        <div className="text-sm leading-relaxed text-muted">{body}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onClose}
          disabled={confirming}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground transition hover:border-white/20 hover:bg-black/30 disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className={[
            "rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60",
            danger
              ? "bg-[linear-gradient(135deg,#ef4444,#f97316)] text-white"
              : "bg-[linear-gradient(135deg,#f472b6,#fb7185,#f59e0b)] text-slate-950",
          ].join(" ")}
        >
          {confirming ? `${confirmLabel}...` : confirmLabel}
        </button>
      </div>
    </ThemedModal>
  );
}
