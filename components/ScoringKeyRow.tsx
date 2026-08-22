"use client";

import React from "react";

export type ScoringKeyTone = "exact" | "result" | "miss";

export type ScoringKeyItem = {
  label: string;
  value: string;
  tone: ScoringKeyTone;
};

const TONE_CLASS: Record<
  ScoringKeyTone,
  { border: string; wash: string; bar: string }
> = {
  exact: {
    border: "border-purple-300/18",
    wash: "bg-[linear-gradient(135deg,rgba(168,85,247,0.1),rgba(6,12,28,0.9))]",
    bar: "from-purple-200 via-purple-300 to-purple-500/20",
  },
  result: {
    border: "border-emerald-300/18",
    wash: "bg-[linear-gradient(135deg,rgba(16,185,129,0.1),rgba(6,12,28,0.9))]",
    bar: "from-emerald-200 via-emerald-300 to-emerald-500/20",
  },
  miss: {
    border: "border-red-300/16",
    wash: "bg-[linear-gradient(135deg,rgba(248,113,113,0.085),rgba(6,12,28,0.9))]",
    bar: "from-red-200/75 via-red-300/55 to-red-500/10",
  },
};

export const LEAGUE_SCORING_ITEMS: ScoringKeyItem[] = [
  { label: "Exact", value: "2 pts", tone: "exact" },
  { label: "Result", value: "1 pt", tone: "result" },
  { label: "Miss", value: "0", tone: "miss" },
];

export const PREDICTION_TONE_ITEMS: ScoringKeyItem[] = [
  { label: "Exact", value: "Scoreline", tone: "exact" },
  { label: "Result", value: "Winner/draw", tone: "result" },
  { label: "Miss", value: "No points", tone: "miss" },
];

export default function ScoringKeyRow({
  items,
  className = "",
}: {
  items: ScoringKeyItem[];
  className?: string;
}) {
  return (
    <div className={["grid grid-cols-3 gap-1.5", className].join(" ").trim()}>
      {items.map((item) => {
        const tone = TONE_CLASS[item.tone];
        return (
          <div
            key={item.label}
            className={[
              "rounded-[14px] border p-[1px] shadow-[0_8px_18px_rgba(2,6,20,0.16)]",
              tone.border,
              tone.wash,
            ].join(" ")}
          >
            <div className="relative overflow-hidden rounded-[13px] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.014))] px-2 py-1.5">
              <div
                className={[
                  "absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-gradient-to-b",
                  tone.bar,
                ].join(" ")}
              />
              <div className="pl-2 leading-none">
                <div className="font-display text-[0.56rem] font-semibold uppercase tracking-[0.12em] text-white/52">
                  {item.label}
                </div>
                <div className="mt-0.5 font-display text-[0.78rem] font-semibold text-foreground">
                  {item.value}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
