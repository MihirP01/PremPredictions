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

  const delayMs = 240 + indexRef.current * 120;
  const animationName =
    sequence % 2 === 0 ? "sectionCardIn" : "sectionCardInAlt";

  return (
    <div
      className="section-card-enter"
      style={{
        animationName,
        animationDuration: "560ms",
        animationTimingFunction: "cubic-bezier(0.2,0,0,1)",
        animationDelay: `${delayMs}ms`,
        animationFillMode: "both",
      }}
    >
      <Panel className={className}>{children}</Panel>
    </div>
  );
}
