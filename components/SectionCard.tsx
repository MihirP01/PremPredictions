"use client";

import React from "react";

type SectionCardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function SectionCard({
  children,
  className = "rounded-[26px] border border-white/10 bg-[linear-gradient(165deg,rgba(10,14,24,0.9),rgba(22,13,34,0.9)_52%,rgba(33,18,10,0.88))] p-4 sm:p-5 shadow-[0_18px_50px_rgba(6,4,18,0.34)]",
}: SectionCardProps) {
  return (
    <div className={["relative overflow-hidden", className].join(" ")}>
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="pointer-events-none absolute bottom-4 right-4 h-10 w-10 rounded-full bg-fuchsia-300/8 blur-2xl" />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
