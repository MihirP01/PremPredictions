import React from "react";
import { Loader2 } from "lucide-react";

const SCORE_OPTIONS = [
  "",
  ...Array.from({ length: 10 }, (_, idx) => String(idx)),
];

type TurnCounterCardProps = {
  label: string;
  current: number;
  total: number;
};

type ScoreSelectProps = {
  value: string;
  onChange: (next: string) => void;
  label: string;
};

type ScoreDeskProps = {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  modeLabel?: string;
  homeScore: string;
  awayScore: string;
  onHomeChange: (next: string) => void;
  onAwayChange: (next: string) => void;
  submitting: boolean;
  disabled: boolean;
  submitLabel?: string;
  onSubmit: () => void;
};

type StatusDeskProps = {
  eyebrow?: string;
  title: React.ReactNode;
  message?: React.ReactNode;
  latestLockedPick?: { fixtureId: number; score: string } | null;
  modeLabel?: string;
  loading?: boolean;
  progressPct?: number;
  progressLabel?: React.ReactNode;
};

type TakenScoresStripProps = {
  scores: string[];
};

export function TurnCounterCard({
  label,
  current,
  total,
}: TurnCounterCardProps) {
  return (
    <div className="min-w-[136px] rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,22,38,0.98),rgba(8,14,28,0.96))] px-4 py-3 text-right shadow-[0_16px_32px_rgba(4,8,16,0.32)]">
      <div className="font-display text-[0.63rem] uppercase tracking-[0.22em] text-muted/90">
        {label}
      </div>
      <div className="mt-1 font-display text-[1.8rem] font-semibold leading-none text-foreground tabular-nums">
        {current}
        <span className="ml-1 text-[0.95rem] font-medium text-muted">
          of {total}
        </span>
      </div>
    </div>
  );
}

export function ScoreSelect({ value, onChange, label }: ScoreSelectProps) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="font-display text-[0.62rem] uppercase tracking-[0.2em] text-muted/85 text-center">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-display h-16 w-full appearance-none rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,20,34,0.98),rgba(8,14,28,0.96))] px-3 text-center text-2xl text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none [text-align-last:center] focus:border-white/16"
      >
        {SCORE_OPTIONS.map((option) => (
          <option key={option || "empty"} value={option}>
            {option === "" ? "-" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ScoreDesk({
  eyebrow = "Score desk",
  title,
  description,
  modeLabel,
  homeScore,
  awayScore,
  onHomeChange,
  onAwayChange,
  submitting,
  disabled,
  submitLabel = "Confirm score",
  onSubmit,
}: ScoreDeskProps) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,16,28,0.98),rgba(7,12,22,0.97))] p-4 shadow-[0_22px_46px_rgba(4,8,16,0.34)] sm:p-5">
      <div className="font-display text-[0.65rem] uppercase tracking-[0.22em] text-muted/85">
        {eyebrow}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-[1.55rem] font-semibold leading-none text-foreground sm:text-[1.7rem]">
            {title}
          </div>
          {description ? (
            <div className="mt-2 text-sm text-muted">{description}</div>
          ) : null}
        </div>
        {modeLabel ? (
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-display text-[0.62rem] uppercase tracking-[0.2em] text-muted/90">
            {modeLabel}
          </div>
        ) : null}
      </div>
      <div className="mt-4 rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,21,36,0.94),rgba(9,15,28,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="font-display text-[0.62rem] uppercase tracking-[0.2em] text-muted/75">
          Pick score
        </div>
        <div className="mt-3 flex items-end justify-center gap-3 sm:gap-4">
          <ScoreSelect value={homeScore} onChange={onHomeChange} label="Home" />
          <span className="pb-4 font-display text-2xl text-muted/80">-</span>
          <ScoreSelect value={awayScore} onChange={onAwayChange} label="Away" />
        </div>
      </div>
      <button
        disabled={disabled}
        onClick={onSubmit}
        className="mt-4 w-full rounded-[18px] border border-amber-200/12 bg-[linear-gradient(90deg,rgba(78,56,33,0.88),rgba(52,42,34,0.82),rgba(78,56,33,0.88))] px-4 py-3 font-display text-base font-semibold tracking-[0.12em] text-foreground shadow-[0_16px_28px_rgba(40,24,10,0.22)] transition hover:border-amber-200/18 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}

export function StatusDesk({
  eyebrow = "Status",
  title,
  message,
  latestLockedPick,
  modeLabel,
  loading = false,
  progressPct,
  progressLabel,
}: StatusDeskProps) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,16,28,0.98),rgba(7,12,22,0.97))] p-4 shadow-[0_18px_38px_rgba(4,8,16,0.28)] sm:p-5">
      <div className="font-display text-[0.65rem] uppercase tracking-[0.22em] text-muted/85">
        {eyebrow}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-[1.35rem] font-semibold leading-tight text-foreground">
            {title}
          </div>
          {message ? (
            <div className="mt-2 text-sm text-muted">{message}</div>
          ) : null}
        </div>
        {modeLabel ? (
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-display text-[0.62rem] uppercase tracking-[0.2em] text-muted/90">
            {modeLabel}
          </div>
        ) : null}
      </div>
      {latestLockedPick ? (
        <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.02] px-3 py-3 text-center">
          <div className="font-display text-[0.6rem] uppercase tracking-[0.2em] text-muted/75">
            Your pick
          </div>
          <div className="mt-1 font-display text-base font-semibold text-foreground tabular-nums">
            {latestLockedPick.score.replace("-", "–")}
          </div>
        </div>
      ) : null}
      {progressPct != null ? (
        <div className="mt-4 space-y-2">
          <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-white/[0.03]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(85,122,178,0.95),rgba(72,109,167,0.82))] transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {progressLabel ? (
            <div className="inline-flex items-center gap-2 text-sm text-muted">
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              <span>{progressLabel}</span>
            </div>
          ) : null}
        </div>
      ) : progressLabel ? (
        <div className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          <span>{progressLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export function TakenScoresStrip({ scores }: TakenScoresStripProps) {
  const sorted = [...scores].sort((a, b) => a.localeCompare(b));
  return (
    <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,18,32,0.92),rgba(8,14,26,0.94))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-display text-[0.62rem] uppercase tracking-[0.2em] text-muted/75">
          Taken scores
        </div>
        <div className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 font-display text-[0.58rem] uppercase tracking-[0.18em] text-muted/80">
          {sorted.length} locked
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {sorted.length === 0 ? (
          <span className="text-sm text-muted">None yet</span>
        ) : (
          sorted.map((score, idx) => (
            <span
              key={`${score}-${idx}`}
              className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-display text-xs font-medium text-foreground tabular-nums"
            >
              {score.replace("-", "–")}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
