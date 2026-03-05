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
  neutral: "bg-white/[0.04] border-white/10 text-white/65",
  you: "bg-[rgba(var(--room-accent-rgb),0.12)] border-[rgba(var(--room-accent-rgb),0.28)] text-foreground",
  ready: "bg-emerald-400/12 border-emerald-300/20 text-emerald-200",
  waiting: "bg-amber-400/12 border-amber-300/20 text-amber-100",
  danger:
    "bg-rose-500/10 border-rose-300/20 text-rose-200 hover:bg-rose-500/16",
};

export default function StatusPill({
  label,
  tone = "neutral",
  className = "",
  onClick,
  invisible = false,
}: StatusPillProps) {
  const base =
    `inline-flex items-center justify-center rounded-full border px-2.5 py-1 font-display text-[0.7rem] font-semibold ${TONE_CLASS[tone]} ${className}`.trim();
  if (onClick) {
    return (
      <button onClick={onClick} className={base}>
        {label}
      </button>
    );
  }
  return (
    <span
      aria-hidden={invisible ? "true" : undefined}
      className={`${invisible ? "invisible " : ""}${base}`}
    >
      {label}
    </span>
  );
}
