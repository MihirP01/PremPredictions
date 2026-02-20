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
  className = "flex items-start justify-between gap-2",
}: TopActionRowProps) {
  return (
    <div className={className}>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <div className="font-display text-sm text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="ml-auto flex gap-2 page-actions-enter">{actions}</div> : null}
    </div>
  );
}
