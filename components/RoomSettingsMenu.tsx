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
        "page-action-btn inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.18)] transition hover:border-white/16 hover:bg-white/[0.06]",
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
        "absolute right-0 top-full mt-2",
        "z-20 w-[min(18rem,calc(100vw-2rem))] rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,24,0.98),rgba(10,18,32,0.98))] p-3 shadow-[0_20px_44px_rgba(3,8,20,0.35)] backdrop-blur-xl",
        "origin-top-right transition-all duration-150 ease-out",
        open
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
