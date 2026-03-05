"use client";

import React from "react";

type PanelProps = {
  children: React.ReactNode;
  className?: string;
};

export default function Panel({
  children,
  className = "rounded-[24px] border p-4 sm:p-5",
}: PanelProps) {
  return (
    <div
      className={["relative overflow-hidden", className].join(" ")}
      style={{
        borderColor: "var(--editorial-panel-border)",
        background: "var(--editorial-panel-bg)",
        boxShadow: "var(--editorial-panel-shadow)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
      }}
    >
      <div className="pointer-events-none absolute inset-[1px] rounded-[23px] bg-[var(--editorial-panel-glass)]" />
      <div
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent, var(--editorial-panel-rule), transparent)",
        }}
      />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
