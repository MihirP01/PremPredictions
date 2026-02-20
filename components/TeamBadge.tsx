"use client";

import React from "react";
import { teamAbbrFromParts } from "@/lib/teamDisplay";

type TeamBadgeProps = {
  name: string;
  tla?: string | null;
  shortName?: string | null;
  badge?: string | null;
  wrapperClassName?: string;
  imageClassName?: string;
  fallbackClassName?: string;
};

export default function TeamBadge({
  name,
  tla,
  shortName,
  badge,
  wrapperClassName = "h-10 w-10 sm:h-11 sm:w-11 xl:h-12 xl:w-12",
  imageClassName = "h-8 w-8 sm:h-9 sm:w-9 xl:h-10 xl:w-10 object-contain",
  fallbackClassName = "text-[10px] sm:text-[11px] font-bold text-foreground",
}: TeamBadgeProps) {
  const fallback = teamAbbrFromParts(name, tla, shortName);

  return (
    <div
      className={`${wrapperClassName} rounded-full flex items-center justify-center overflow-hidden shrink-0`}
    >
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={badge} alt={name} className={imageClassName} loading="lazy" />
      ) : (
        <span className={fallbackClassName}>{fallback}</span>
      )}
    </div>
  );
}
