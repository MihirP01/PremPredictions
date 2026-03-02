"use client";

import React from "react";

type PageShellProps = {
  children: React.ReactNode;
  innerClassName?: string;
  outerClassName?: string;
};

export default function PageShell({
  children,
  innerClassName = "relative w-full max-w-[1480px] mx-auto overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,16,31,0.94)_0%,rgba(8,16,31,0.82)_100%)] px-5 py-5 shadow-card page-shell-enter sm:px-8 sm:py-7 space-y-5",
  outerClassName = "min-h-0 px-3 pb-3 pt-0 sm:px-8 sm:pb-8 sm:pt-2 bg-app",
}: PageShellProps) {
  return (
    <div className={outerClassName}>
      <div className={innerClassName}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(56,189,248,0.08)_0%,rgba(56,189,248,0)_100%)]" />
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.18)_0%,rgba(20,184,166,0)_68%)]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.12)_0%,rgba(56,189,248,0)_70%)]" />
        <div className="relative z-[1] space-y-5">{children}</div>
      </div>
    </div>
  );
}
