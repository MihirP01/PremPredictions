"use client";

import React, { useContext } from "react";
import PageHeader from "./PageHeader";
import { PageShellMotionContext } from "./PageShellMotionContext";

type TopActionRowProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  frameActions?: boolean;
};

export default function TopActionRow({
  title,
  subtitle,
  actions,
  className = "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
  frameActions = true,
}: TopActionRowProps) {
  const motion = useContext(PageShellMotionContext);
  const sequence = motion?.sequence ?? 0;

  return (
    <div
      key={sequence}
      className="top-action-row-enter relative z-[140] overflow-visible"
      style={{
        animationDelay: "0ms",
      }}
    >
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={actions}
        className={className}
        frameActions={frameActions}
      />
    </div>
  );
}
