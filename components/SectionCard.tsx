"use client";

import React from "react";

type SectionCardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function SectionCard({
  children,
  className = "rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.92)_0%,rgba(12,20,36,0.78)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_20px_40px_rgba(2,8,23,0.24)] sm:p-5",
}: SectionCardProps) {
  return <div className={className}>{children}</div>;
}
