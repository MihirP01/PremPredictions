"use client";

import React from "react";

type AppShellProps = {
  children: React.ReactNode;
  className?: string;
};

export default function AppShell({
  children,
  className = "min-h-0 px-2 pb-2 pt-0 sm:px-5 sm:pb-5 sm:pt-3 bg-app",
}: AppShellProps) {
  return <div className={className}>{children}</div>;
}
