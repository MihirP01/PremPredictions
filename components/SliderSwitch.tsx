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
  className = "relative grid rounded-lg border border-teal-500 bg-surface p-1 overflow-hidden",
  indicatorClassName = "absolute top-1 bottom-1 rounded-md border border-[color:rgba(var(--room-accent-rgb),0.72)] bg-[color:rgba(var(--room-accent-rgb),0.22)] shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.2)] transition-all duration-300",
  buttonClassName = "relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors text-foreground",
  activeButtonClassName = "text-foreground",
}: SliderSwitchProps<T>) {
  const count = Math.max(options.length, 1);
  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );

  return (
    <div
      className={className}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className={indicatorClassName}
        style={{
          width: `calc((100% - 0.5rem) / ${count})`,
          left: `calc(0.25rem + (${activeIndex} * (100% - 0.5rem) / ${count}))`,
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
