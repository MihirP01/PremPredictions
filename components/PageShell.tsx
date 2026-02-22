"use client";

import React from "react";

type PageShellProps = {
  children: React.ReactNode;
  innerClassName?: string;
  outerClassName?: string;
};

export default function PageShell({
  children,
  innerClassName = "w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500",
  outerClassName = "min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app",
}: PageShellProps) {
  return (
    <div className={outerClassName}>
      <div className={innerClassName}>{children}</div>
    </div>
  );
}
