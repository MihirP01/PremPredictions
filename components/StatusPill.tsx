"use client";

import React from "react";

type StatusTone = "neutral" | "you" | "ready" | "waiting" | "danger";

type StatusPillProps = {
  label: React.ReactNode;
  tone?: StatusTone;
  className?: string;
  onClick?: () => void;
  invisible?: boolean;
};

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-surface border border-teal-500 text-muted",
  you: "bg-surface border border-teal-500 text-muted",
  ready: "bg-emerald-400/15 border border-emerald-400 text-emerald-300",
  waiting: "bg-amber-400/15 border border-amber-400 text-amber-300",
  danger: "bg-surface border border-teal-500 text-danger hover:bg-surface-2",
};

export default function StatusPill({
  label,
  tone = "neutral",
  className = "",
  onClick,
  invisible = false,
}: StatusPillProps) {
  const base = `font-display text-xs px-2 py-1 rounded-full ${TONE_CLASS[tone]} ${className}`.trim();
  if (onClick) {
    return (
      <button onClick={onClick} className={base}>
        {label}
      </button>
    );
  }
  return (
    <span aria-hidden={invisible ? "true" : undefined} className={`${invisible ? "invisible " : ""}${base}`}>
      {label}
    </span>
  );
}
