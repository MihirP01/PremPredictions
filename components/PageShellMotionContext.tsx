"use client";

import React from "react";

export type PageShellMotionContextValue = {
  sequence: number;
  nextIndex: () => number;
};

export const PageShellMotionContext =
  React.createContext<PageShellMotionContextValue | null>(null);
