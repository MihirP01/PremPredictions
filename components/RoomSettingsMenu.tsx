"use client";

import React from "react";
import { Settings } from "lucide-react";

type SettingsTriggerButtonProps = {
  onClick: () => void;
  className?: string;
};

type SettingsDropdownPanelProps = {
  open: boolean;
  children: React.ReactNode;
  className?: string;
};

export function SettingsTriggerButton({
  onClick,
  className = "",
}: SettingsTriggerButtonProps) {
  return (
    <button
      onClick={onClick}
      className={[
        "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-foreground",
        "hover:border-[color:rgba(var(--room-accent-rgb),0.4)] hover:bg-white/[0.06]",
        "page-action-btn",
        className,
      ].join(" ")}
      data-action="settings"
      aria-label="Open settings"
    >
      <Settings size={16} />
    </button>
  );
}

export function SettingsDropdownPanel({
  open,
  children,
  className = "",
}: SettingsDropdownPanelProps) {
  return (
    <div
      className={[
        "absolute right-0 top-full mt-2 sm:top-0 sm:right-[calc(100%+12px)] sm:mt-0",
        "z-20 w-[min(19rem,calc(100vw-3rem))] sm:w-80 rounded-2xl border border-white/8",
        "bg-[linear-gradient(180deg,rgba(10,19,36,0.98)_0%,rgba(8,16,31,0.94)_100%)] p-3.5 space-y-2 shadow-[0_24px_40px_rgba(2,8,23,0.38)]",
        "origin-top-right sm:origin-top-left transition-all duration-150 ease-out",
        open
          ? "opacity-100 translate-y-0 sm:translate-y-0 sm:translate-x-0 scale-100 pointer-events-auto"
          : "opacity-0 -translate-y-1 sm:translate-y-0 sm:translate-x-1 scale-[0.98] pointer-events-none",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
