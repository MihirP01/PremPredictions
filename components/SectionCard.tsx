"use client";

import React from "react";

type SectionCardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function SectionCard({
  children,
  className = "border border-teal-500 rounded-xl p-4 bg-surface-2",
}: SectionCardProps) {
  return <div className={className}>{children}</div>;
}
