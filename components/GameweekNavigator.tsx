"use client";

import React, { useMemo } from "react";

type GameweekNavigatorProps = {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  className?: string;
  buttonClassName?: string;
  selectClassName?: string;
};

export default function GameweekNavigator({
  value,
  min = 1,
  max = 38,
  disabled = false,
  onChange,
  className = "gw-nav-controls mx-auto flex w-full max-w-md items-center gap-3",
  buttonClassName = "flex h-[clamp(2.7rem,3.2vw,3.1rem)] w-[clamp(2.7rem,3.2vw,3.1rem)] items-center justify-center rounded-[18px] border border-white/10 bg-black/20 p-0 leading-none text-foreground shadow-[0_10px_22px_rgba(0,0,0,0.18)] transition hover:border-white/20 hover:bg-black/30 disabled:opacity-40",
  selectClassName = "h-[clamp(2.7rem,3.2vw,3.1rem)] w-full rounded-[18px] border border-white/10 bg-black/20 px-8 text-center font-display text-[clamp(0.8rem,1.1vw,0.98rem)] font-semibold uppercase tracking-[0.16em] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] appearance-none [text-align-last:center] outline-none transition focus:border-white/20 focus:bg-black/30",
}: GameweekNavigatorProps) {
  const options = useMemo(() => Array.from({ length: max - min + 1 }, (_, i) => min + i), [max, min]);

  return (
    <div className={className}>
      <button
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={buttonClassName}
        aria-label="Previous gameweek"
      >
        <span className="block h-0 w-0 border-y-[6px] border-y-transparent border-r-[9px] border-r-current" />
      </button>

      <div className="relative min-w-0 flex-1">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className={selectClassName}
          aria-label="Select gameweek"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              GW {n}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/45">▼</span>
      </div>

      <button
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className={buttonClassName}
        aria-label="Next gameweek"
      >
        <span className="block h-0 w-0 border-y-[6px] border-y-transparent border-l-[9px] border-l-current" />
      </button>
    </div>
  );
}
