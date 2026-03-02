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
  neutral: "border-white/10 bg-black/20 text-white/70",
  you: "border-white/12 bg-white/8 text-foreground",
  ready: "border-emerald-300/25 bg-emerald-400/12 text-emerald-200",
  waiting: "border-amber-300/25 bg-amber-400/12 text-amber-100",
  danger: "border-red-300/25 bg-red-500/10 text-red-200 hover:bg-red-500/16",
};

export default function StatusPill({
  label,
  tone = "neutral",
  className = "",
  onClick,
  invisible = false,
}: StatusPillProps) {
  const base = `inline-flex items-center justify-center rounded-full border px-2.5 py-1 font-display text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${TONE_CLASS[tone]} ${className}`.trim();
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
