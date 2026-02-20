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
      zIndexClassName="z-50"
      overlayClassName="bg-black/50 backdrop-blur-sm"
      panelClassName={`w-full ${maxWidthClassName} rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface p-4 space-y-4 ${panelClassName}`.trim()}
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
      <div className="text-lg font-semibold text-foreground">{title}</div>
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
      <div className="font-semibold text-foreground">{title}</div>
      <div className="text-sm text-muted">{body}</div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={confirming}
          className="rounded-lg border border-teal-500 px-4 py-2 bg-surface text-foreground hover:bg-surface-2 disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className={[
            "rounded-lg px-4 py-2 text-white disabled:opacity-60",
            danger ? "bg-red-600 hover:bg-red-500" : "bg-accent text-accent-foreground",
          ].join(" ")}
        >
          {confirming ? `${confirmLabel}...` : confirmLabel}
        </button>
      </div>
    </ThemedModal>
  );
}
