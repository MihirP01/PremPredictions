"use client";

import React from "react";

export type PageLayoutWidth = "tight" | "standard" | "wide";

type PageLayoutProps = {
  children: React.ReactNode;
  width?: PageLayoutWidth;
  className?: string;
};

const WIDTH_CLASS: Record<PageLayoutWidth, string> = {
  tight: "max-w-[960px]",
  standard: "max-w-[1180px]",
  wide: "max-w-[1440px]",
};

export default function PageLayout({
  children,
  width = "wide",
  className = "",
}: PageLayoutProps) {
  return (
    <div
      className={[
        "w-full mx-auto page-shell-enter relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(160deg,rgba(9,18,34,0.96),rgba(10,27,46,0.94)_55%,rgba(14,45,63,0.92))] p-4 sm:p-6 shadow-[0_28px_70px_rgba(3,8,20,0.42)]",
        WIDTH_CLASS[width],
        className,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
      <div className="pointer-events-none absolute right-8 top-8 h-20 w-20 rounded-full bg-sky-300/8 blur-3xl" />
      {children}
    </div>
  );
}
