"use client";

import React from "react";

export type PageLayoutWidth = "tight" | "standard" | "wide";

type PageLayoutProps = {
  children: React.ReactNode;
  width?: PageLayoutWidth;
  className?: string;
  shellChrome?: boolean;
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
  shellChrome = true,
}: PageLayoutProps) {
  if (!shellChrome) {
    return (
      <div
        className={[
          "w-full mx-auto relative",
          WIDTH_CLASS[width],
          className,
        ].join(" ")}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={[
        "w-full mx-auto page-shell-enter relative overflow-hidden rounded-[30px] border p-4 sm:p-6",
        WIDTH_CLASS[width],
        className,
      ].join(" ")}
      style={{
        borderColor: "var(--editorial-shell-border)",
        background: "var(--editorial-shell-bg)",
        boxShadow: "var(--editorial-shell-shadow)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent, var(--editorial-shell-hairline), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute left-8 top-8 h-24 w-24 rounded-full blur-3xl"
        style={{ background: "var(--editorial-shell-glow-a)" }}
      />
      <div
        className="pointer-events-none absolute right-10 top-10 h-20 w-20 rounded-full blur-3xl"
        style={{ background: "var(--editorial-shell-glow-b)" }}
      />
      <div className="pointer-events-none absolute inset-[1px] rounded-[29px] border border-white/[0.03] sm:hidden" />
      {children}
    </div>
  );
}
