"use client";

import React, { useContext, useRef } from "react";
import Panel from "./Panel";
import { PageShellMotionContext } from "./PageShellMotionContext";

type SectionCardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function SectionCard({
  children,
  className = "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5",
}: SectionCardProps) {
  const motion = useContext(PageShellMotionContext);
  const sequence = motion?.sequence ?? 0;
  const sequenceRef = useRef(-1);
  const indexRef = useRef(0);

  if (sequenceRef.current !== sequence) {
    sequenceRef.current = sequence;
    indexRef.current = motion?.nextIndex ? motion.nextIndex() : 0;
  }

  const delayMs = Math.min(indexRef.current, 5) * 70;

  return (
    <div
      key={sequence}
      className="section-card-enter"
      style={{
        animationDelay: `${delayMs}ms`,
      }}
    >
      <Panel className={className}>{children}</Panel>
    </div>
  );
}
