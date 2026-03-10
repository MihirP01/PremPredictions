"use client";

import React from "react";

type SectionStackGap = "tight" | "page" | "fixture";

type SectionStackProps = {
  children: React.ReactNode;
  className?: string;
  gap?: SectionStackGap;
};

const GAP_CLASS: Record<SectionStackGap, string> = {
  tight: "gap-2 sm:gap-3",
  page: "gap-2 sm:gap-4",
  fixture: "gap-5 sm:gap-6",
};

export default function SectionStack({
  children,
  className = "",
  gap = "page",
}: SectionStackProps) {
  return (
    <div
      className={["grid auto-rows-max", GAP_CLASS[gap], className]
        .join(" ")
        .trim()}
    >
      {children}
    </div>
  );
}
