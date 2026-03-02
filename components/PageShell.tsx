"use client";

import React from "react";
import AppShell from "./AppShell";
import PageLayout, { type PageLayoutWidth } from "./PageLayout";

type PageShellProps = {
  children: React.ReactNode;
  innerClassName?: string;
  outerClassName?: string;
  width?: PageLayoutWidth;
  contentClassName?: string;
};

export default function PageShell({
  children,
  innerClassName = "",
  outerClassName = "min-h-0 px-2 pb-2 pt-0 sm:px-5 sm:pb-5 sm:pt-3 bg-app",
  width = "wide",
  contentClassName = "relative z-[1] space-y-4",
}: PageShellProps) {
  return (
    <AppShell className={outerClassName}>
      <PageLayout width={width} className={innerClassName}>
        <div className={contentClassName}>{children}</div>
      </PageLayout>
    </AppShell>
  );
}
