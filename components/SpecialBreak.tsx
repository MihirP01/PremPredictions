"use client";

import React from "react";

export default function SpecialBreak({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={["flex w-full items-center justify-center gap-3", className]
        .join(" ")
        .trim()}
    >
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/16 to-white/4" />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
        <span
          className="h-1.5 w-1.5 rounded-full bg-[rgba(var(--room-accent-rgb),0.78)]"
          aria-hidden
        />
        <span
          className="h-px w-8 bg-gradient-to-r from-[rgba(var(--room-accent-rgb),0.14)] to-[rgba(var(--room-accent-rgb),0.55)]"
          aria-hidden
        />
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-white/16 to-white/4" />
    </div>
  );
}
