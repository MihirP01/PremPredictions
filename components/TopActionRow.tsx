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
  const animationName =
    sequence % 2 === 0 ? "topActionRowIn" : "topActionRowInAlt";

  return (
    <div
      className="top-action-row-enter relative z-[140] overflow-visible"
      style={{
        animationName,
        animationDuration: "500ms",
        animationTimingFunction: "cubic-bezier(0.2,0,0,1)",
        animationDelay: "60ms",
        animationFillMode: "both",
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
