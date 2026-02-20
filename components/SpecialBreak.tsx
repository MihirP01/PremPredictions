"use client";

import React from "react";

export default function SpecialBreak({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full flex items-center justify-center gap-1.5 ${className}`.trim()}>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.05)_0%,rgba(var(--room-accent-rgb),0.42)_100%)]" />
      <span
        className="h-1.5 w-1.5 rounded-full border border-[color:rgba(var(--room-accent-rgb),0.75)] bg-[color:rgba(var(--room-accent-rgb),0.55)]"
        aria-hidden
      />
      <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.42)_0%,rgba(var(--room-accent-rgb),0.05)_100%)]" />
    </div>
  );
}
