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
        "page-action-btn inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.18)] transition",
        className,
      ].join(" ")}
      data-action="settings"
      aria-label="Open settings"
      style={{
        borderColor: "var(--editorial-action-border)",
        background: "var(--editorial-action-bg)",
      }}
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
      data-settings-dropdown-root="true"
      className={[
        "absolute right-0 top-full mt-2",
        "z-[420] w-[min(22rem,calc(100vw-1.5rem))] rounded-[22px] border p-3 shadow-[0_20px_44px_rgba(3,8,20,0.35)] backdrop-blur-xl",
        "origin-top-right transition-all duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
        open
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0",
        className,
      ].join(" ")}
      style={{
        borderColor: "var(--editorial-modal-border)",
        background: "var(--editorial-modal-bg)",
      }}
    >
      {children}
    </div>
  );
}
