"use client";

import React from "react";

type SectionGridGap = "tight" | "page";

type SectionGridProps = {
  children: React.ReactNode;
  className?: string;
  gap?: SectionGridGap;
};

const GAP_CLASS: Record<SectionGridGap, string> = {
  tight: "gap-2 sm:gap-3",
  page: "gap-2 sm:gap-4",
};

export default function SectionGrid({
  children,
  className = "",
  gap = "page",
}: SectionGridProps) {
  return (
    <div className={["grid", GAP_CLASS[gap], className].join(" ").trim()}>
      {children}
    </div>
  );
}
