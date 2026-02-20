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
  className = "gw-nav-controls flex items-center gap-3 w-full max-w-md mx-auto",
  buttonClassName = `
    h-[clamp(2.45rem,3.2vw,2.85rem)] w-[clamp(2.45rem,3.2vw,2.85rem)]
    flex items-center justify-center p-0 leading-none rounded-lg
    bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-40
  `,
  selectClassName = `
    w-full h-[clamp(2.45rem,3.2vw,2.85rem)] px-8 rounded-lg border border-teal-500
    bg-surface text-foreground text-[clamp(0.85rem,1.1vw,1rem)] font-semibold text-center
    appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500
  `,
}: GameweekNavigatorProps) {
  const options = useMemo(
    () => Array.from({ length: max - min + 1 }, (_, i) => min + i),
    [max, min],
  );

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
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          ▼
        </span>
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
