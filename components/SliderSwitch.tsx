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
  className = "relative grid overflow-hidden rounded-[22px] border border-white/10 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
  indicatorClassName = "absolute bottom-1.5 top-1.5 rounded-[16px] bg-[linear-gradient(135deg,rgba(244,114,182,0.28),rgba(249,115,22,0.22))] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_12px_22px_rgba(0,0,0,0.18)] transition-all duration-300",
  buttonClassName = "relative z-10 rounded-[16px] px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors",
  activeButtonClassName = "text-foreground",
}: SliderSwitchProps<T>) {
  const count = Math.max(options.length, 1);
  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );

  return (
    <div className={className} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className={indicatorClassName}
        style={{
          width: `calc((100% - 0.75rem) / ${count})`,
          left: `calc(0.375rem + (${activeIndex} * (100% - 0.75rem) / ${count}))`,
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`${buttonClassName} ${value === opt.value ? activeButtonClassName : ""}`.trim()}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
