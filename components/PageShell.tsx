"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import AppShell from "./AppShell";
import PageLayout, { type PageLayoutWidth } from "./PageLayout";
import { PageShellMotionContext } from "./PageShellMotionContext";

type PageShellProps = {
  children: React.ReactNode;
  innerClassName?: string;
  outerClassName?: string;
  width?: PageLayoutWidth;
  contentClassName?: string;
  shellChrome?: boolean;
};

export default function PageShell({
  children,
  innerClassName = "",
  outerClassName = "min-h-0 px-2 pb-2 pt-0 sm:px-5 sm:pb-5 sm:pt-3 bg-app",
  width = "wide",
  contentClassName = "relative z-[1] space-y-4",
  shellChrome = true,
}: PageShellProps) {
  const pathname = usePathname();
  const [sequence, setSequence] = useState(0);
  const counterRef = useRef(0);

  useEffect(() => {
    counterRef.current = 0;
    setSequence((s) => s + 1);
  }, [pathname]);

  const motionCtx = useMemo(
    () => ({
      sequence,
      nextIndex: () => {
        const idx = counterRef.current;
        counterRef.current += 1;
        return idx;
      },
    }),
    [sequence],
  );

  return (
    <AppShell className={outerClassName}>
      <PageLayout
        width={width}
        className={innerClassName}
        shellChrome={shellChrome}
      >
        <PageShellMotionContext.Provider value={motionCtx}>
          <div data-section-stagger-scope className={contentClassName}>
            {children}
          </div>
        </PageShellMotionContext.Provider>
      </PageLayout>
    </AppShell>
  );
}
