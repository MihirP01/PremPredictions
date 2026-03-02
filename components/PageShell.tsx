"use client";

import React from "react";

type PageShellProps = {
  children: React.ReactNode;
  innerClassName?: string;
  outerClassName?: string;
};

export default function PageShell({
  children,
  innerClassName = "w-full max-w-[1460px] mx-auto page-shell-enter relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(150deg,rgba(13,19,32,0.96),rgba(35,12,47,0.94)_48%,rgba(66,24,11,0.92))] p-4 sm:p-6 shadow-[0_32px_90px_rgba(7,5,20,0.6)]",
  outerClassName = "min-h-0 px-2 pb-2 pt-0 sm:px-5 sm:pb-5 sm:pt-3 bg-app",
}: PageShellProps) {
  return (
    <div className={outerClassName}>
      <div className={innerClassName}>
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="pointer-events-none absolute inset-y-10 left-0 w-px bg-gradient-to-b from-transparent via-fuchsia-300/20 to-transparent" />
        <div className="pointer-events-none absolute inset-y-10 right-0 w-px bg-gradient-to-b from-transparent via-orange-300/20 to-transparent" />
        <div className="pointer-events-none absolute right-6 top-6 h-24 w-24 rounded-full bg-fuchsia-400/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-8 left-10 h-28 w-28 rounded-full bg-orange-400/10 blur-3xl" />
        <div className="relative z-[1] space-y-4">{children}</div>
      </div>
    </div>
  );
}
