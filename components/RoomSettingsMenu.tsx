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
        "page-action-btn inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition duration-150 hover:border-white/20 hover:bg-black/30",
        className,
      ].join(" ")}
      data-action="settings"
      aria-label="Open settings"
    >
      <Settings size={17} />
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
        "absolute right-0 top-full mt-2 sm:right-[calc(100%+14px)] sm:top-0 sm:mt-0",
        "z-20 w-[min(19rem,calc(100vw-2rem))] rounded-[24px] border border-white/10",
        "bg-[linear-gradient(155deg,rgba(12,15,26,0.96),rgba(31,14,42,0.96)_55%,rgba(50,20,11,0.94))] p-3 shadow-[0_20px_60px_rgba(4,4,16,0.5)] backdrop-blur-xl",
        "origin-top-right sm:origin-top-left transition-all duration-180 ease-out",
        open
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none -translate-y-1 scale-[0.97] opacity-0 sm:translate-x-1 sm:translate-y-0",
        className,
      ].join(" ")}
    >
      <div className="rounded-[18px] border border-white/6 bg-black/15 p-2">{children}</div>
    </div>
  );
}
