"use client";

import React from "react";

type PageShellProps = {
  children: React.ReactNode;
  innerClassName?: string;
  outerClassName?: string;
};

export default function PageShell({
  children,
  innerClassName = "w-full max-w-[1440px] mx-auto page-shell-enter relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(160deg,rgba(9,18,34,0.96),rgba(10,27,46,0.94)_55%,rgba(14,45,63,0.92))] p-4 sm:p-6 shadow-[0_28px_70px_rgba(3,8,20,0.42)]",
  outerClassName = "min-h-0 px-2 pb-2 pt-0 sm:px-5 sm:pb-5 sm:pt-3 bg-app",
}: PageShellProps) {
  return (
    <div className={outerClassName}>
      <div className={innerClassName}>
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
        <div className="pointer-events-none absolute right-8 top-8 h-20 w-20 rounded-full bg-sky-300/8 blur-3xl" />
        <div className="relative z-[1] space-y-4">{children}</div>
      </div>
    </div>
  );
}
