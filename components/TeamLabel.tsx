"use client";

import React from "react";
import { teamAbbrFromParts } from "@/lib/teamDisplay";
import PendulumName from "./PendulumName";

type TeamLabelProps = {
  name: string;
  tla?: string | null;
  shortName?: string | null;
  wrapperClassName?: string;
  abbrClassName?: string;
  fullNameClassName?: string;
  fullNameWindowPx?: number | null;
};

export default function TeamLabel({
  name,
  tla,
  shortName,
  wrapperClassName = "mt-1 text-xs font-semibold text-foreground truncate w-full",
  abbrClassName = "font-display block",
  fullNameClassName = "font-display block text-[10px] font-medium text-muted w-[68px] sm:w-full mx-auto",
  fullNameWindowPx = null,
}: TeamLabelProps) {
  return (
    <div className={wrapperClassName}>
      <span className={abbrClassName}>
        {teamAbbrFromParts(name, tla, shortName)}
      </span>
      <PendulumName
        text={name}
        windowPx={fullNameWindowPx}
        className={fullNameClassName}
      />
    </div>
  );
}
