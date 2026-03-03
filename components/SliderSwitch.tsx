"use client";

import React from "react";

type Option<T extends string> = { value: T; label: React.ReactNode };

type SliderSwitchProps<T extends string> = {
  options: Array<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  indicatorClassName?: string;
  buttonClassName?: string;
  activeButtonClassName?: string;
};

export default function SliderSwitch<T extends string>({
  options,
  value,
  onChange,
  className = "relative grid overflow-hidden rounded-2xl border p-1",
  indicatorClassName = "absolute bottom-1 top-1 rounded-[14px] transition-all duration-300",
  buttonClassName = "rounded-[14px] px-2.5 py-2 text-white/60 transition-colors",
  activeButtonClassName = "text-foreground",
}: SliderSwitchProps<T>) {
  const count = Math.max(options.length, 1);
  const activeIndex = Math.max(0, options.findIndex((opt) => opt.value === value));
  const baseButtonClass =
    "relative z-10 flex w-full min-w-0 items-center justify-center overflow-hidden text-center";
  const baseLabelClass =
    "block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-display text-[0.64rem] font-semibold uppercase tracking-[0.08em] leading-none";

  return (
    <div
      className={className}
      style={{
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        borderColor: "var(--editorial-segment-border)",
        background: "var(--editorial-segment-bg)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      <span
        aria-hidden
        className={indicatorClassName}
        style={{
          width: `calc((100% - 0.5rem) / ${count})`,
          left: `calc(0.25rem + (${activeIndex} * (100% - 0.5rem) / ${count}))`,
          background: "var(--editorial-segment-indicator)",
          boxShadow: "var(--editorial-segment-shadow)",
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`${baseButtonClass} ${buttonClassName} ${value === opt.value ? activeButtonClassName : ""}`.trim()}
        >
          <span className={baseLabelClass}>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
