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
        "h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500",
        "text-foreground hover:bg-surface-2 inline-flex items-center justify-center",
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
        "w-[min(18rem,calc(100vw-3rem))] sm:w-72 rounded-xl border border-teal-500",
        "bg-surface-2 p-3 space-y-2 shadow-card z-20",
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
