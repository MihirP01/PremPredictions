"use client";

import React from "react";

export default function SpecialBreak({ className = "" }: { className?: string }) {
  return (
    <div className={["flex w-full items-center justify-center gap-3", className].join(" ").trim()}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/18 to-white/2" />
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-300/75" aria-hidden />
        <span className="h-1.5 w-6 rounded-full bg-gradient-to-r from-fuchsia-300/70 via-orange-300/55 to-transparent" aria-hidden />
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-white/18 to-white/2" />
    </div>
  );
}
