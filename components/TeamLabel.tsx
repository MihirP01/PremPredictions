"use client";

import React from "react";
import { teamAbbrFromParts } from "@/lib/teamDisplay";
import PendulumName from "./PendulumName";

type TeamLabelProps = {
  name: string;
  tla?: string | null;
  shortName?: string | null;
  showFullName?: boolean;
  wrapperClassName?: string;
  abbrClassName?: string;
  fullNameClassName?: string;
  fullNameWindowPx?: number | null;
};

export default function TeamLabel({
  name,
  tla,
  shortName,
  showFullName = true,
  wrapperClassName = "mt-1 text-xs font-semibold text-foreground truncate w-full text-center",
  abbrClassName = "font-display block text-[0.78rem] font-semibold",
  fullNameClassName = "font-display block text-[10px] font-medium text-white/52 w-[68px] sm:w-full mx-auto mt-1",
  fullNameWindowPx = null,
}: TeamLabelProps) {
  return (
    <div className={wrapperClassName}>
      <span className={abbrClassName}>{teamAbbrFromParts(name, tla, shortName)}</span>
      {showFullName ? <PendulumName text={name} windowPx={fullNameWindowPx} className={fullNameClassName} /> : null}
    </div>
  );
}
