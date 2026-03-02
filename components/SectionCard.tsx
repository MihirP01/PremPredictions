"use client";

import React from "react";

type SectionCardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function SectionCard({
  children,
  className = "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,20,34,0.9),rgba(13,25,42,0.88))] p-4 sm:p-5 shadow-[0_14px_34px_rgba(3,8,20,0.22)]",
}: SectionCardProps) {
  return (
    <div className={["relative overflow-hidden", className].join(" ")}>
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
