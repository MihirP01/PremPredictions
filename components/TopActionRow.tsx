"use client";

import React from "react";

type TopActionRowProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export default function TopActionRow({
  title,
  subtitle,
  actions,
  className = "flex flex-col gap-4 border-b border-white/8 pb-4 md:flex-row md:items-start md:justify-between",
}: TopActionRowProps) {
  return (
    <div className={className}>
      <div className="space-y-1">
        {subtitle ? (
          <div className="font-display text-[11px] uppercase tracking-[0.24em] text-muted">
            {subtitle}
          </div>
        ) : null}
        <h1 className="font-display text-[clamp(1.9rem,3vw,2.7rem)] font-semibold tracking-[-0.03em] text-foreground">
          {title}
        </h1>
      </div>
      {actions ? (
        <div className="page-actions-enter ml-auto flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.02] p-1.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
