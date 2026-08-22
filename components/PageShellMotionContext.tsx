"use client";

import React, { useContext, useRef } from "react";

export type PageShellMotionContextValue = {
  sequence: number;
  nextIndex: () => number;
  resetIndex: () => void;
};

export const PageShellMotionContext =
  React.createContext<PageShellMotionContextValue | null>(null);

export function StaggerReset({ token }: { token: string | number | boolean }) {
  const motion = useContext(PageShellMotionContext);
  const prev = useRef(token);
  if (prev.current !== token) {
    motion?.resetIndex();
    prev.current = token;
  }
  return null;
}
