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
      overlayClassName="bg-[rgba(2,8,23,0.72)] backdrop-blur-md"
      panelClassName={`w-full ${maxWidthClassName} rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,19,36,0.98)_0%,rgba(8,16,31,0.94)_100%)] p-5 space-y-4 shadow-[0_28px_50px_rgba(2,8,23,0.48)] ${panelClassName}`.trim()}
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
    <div className="flex items-center justify-between">
      <div className="font-display text-lg font-semibold text-foreground">{title}</div>
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
      <div className="font-display font-semibold text-foreground">{title}</div>
      <div className="text-sm text-muted">{body}</div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={confirming}
          className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2 text-foreground hover:bg-white/[0.05] disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className={[
            "rounded-xl px-4 py-2 disabled:opacity-60",
            danger
              ? "border border-rose-400/30 bg-rose-500/8 text-danger hover:bg-rose-500/12"
              : "bg-[linear-gradient(180deg,rgba(56,189,248,1)_0%,rgba(14,165,233,0.92)_100%)] text-accent-foreground shadow-[0_16px_24px_rgba(14,165,233,0.22)]",
          ].join(" ")}
        >
          {confirming ? `${confirmLabel}...` : confirmLabel}
        </button>
      </div>
    </ThemedModal>
  );
}
