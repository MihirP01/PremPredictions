import React from "react";
import { Loader2 } from "lucide-react";

const SCORE_OPTIONS = Array.from({ length: 10 }, (_, idx) => String(idx));

type TurnProps = {
  turnNumber: number;
  totalTurns: number;
};

type LatestPick = {
  fixtureId: number;
  score: string;
} | null;

type ActionProps = {
  myLockedIn: boolean;
  isCaptainMode?: boolean;
  latestLockedPick: LatestPick;
  lockedProgressPct: number;
  playersLeftToLock: number;
  homeScore: string;
  awayScore: string;
  onHomeChange: (next: string) => void;
  onAwayChange: (next: string) => void;
  submitting: boolean;
  isLocked: boolean;
  hasFixture: boolean;
  onSubmit: () => void;
  btnClassName: string;
};

export function SprintTurnIndicator({ turnNumber, totalTurns }: TurnProps) {
  return (
    <>
      <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
        Turn {turnNumber}
      </div>
      <div className="font-display text-sm tracking-wide text-muted">Out of {totalTurns}</div>
    </>
  );
}

export function SprintActionPanel({
  myLockedIn,
  isCaptainMode = false,
  latestLockedPick,
  lockedProgressPct,
  playersLeftToLock,
  homeScore,
  awayScore,
  onHomeChange,
  onAwayChange,
  submitting,
  isLocked,
  hasFixture,
  onSubmit,
  btnClassName,
}: ActionProps) {
  if (myLockedIn) {
    const panelClass = isCaptainMode
      ? "rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border border-[color:rgba(var(--room-accent-rgb),0.75)] bg-[linear-gradient(180deg,rgba(var(--room-accent-rgb),0.16)_0%,rgba(var(--room-accent-rgb),0.06)_100%)] shadow-[0_10px_24px_rgba(var(--room-accent-rgb),0.14)]"
      : "border border-teal-500 rounded-xl bg-surface-2";
    return (
      <div className={`${panelClass} p-4 text-foreground space-y-3 text-center`}>
        <div className="inline-flex items-center rounded-full border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-[color:rgba(var(--room-accent-rgb),0.2)] px-3 py-1 text-xs font-display font-semibold text-foreground">
          Locked In
        </div>
        {latestLockedPick && (
          <div className="text-sm text-muted">
            Your pick:{" "}
            <span className="font-display text-foreground font-semibold tabular-nums">
              {latestLockedPick.score.replace("-", "–")}
            </span>
          </div>
        )}
        <div className="w-full h-2 rounded-full border border-[color:rgba(var(--room-accent-rgb),0.55)] bg-surface overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${lockedProgressPct}%` }}
          />
        </div>
        <div className="text-sm text-muted inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span>Waiting for others... {playersLeftToLock} left.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
      <div className="font-semibold text-foreground">Submit your pick</div>
      <div className="flex items-center justify-center gap-3">
        <select
          value={homeScore}
          onChange={(e) => onHomeChange(e.target.value)}
          className="font-display h-16 w-16 rounded-lg border border-teal-500 bg-input text-center text-2xl text-foreground focus:outline-none focus:ring-2 focus:ring-accent appearance-none [text-align-last:center]"
        >
          {SCORE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className="text-2xl text-muted">-</span>
        <select
          value={awayScore}
          onChange={(e) => onAwayChange(e.target.value)}
          className="font-display h-16 w-16 rounded-lg border border-teal-500 bg-input text-center text-2xl text-foreground focus:outline-none focus:ring-2 focus:ring-accent appearance-none [text-align-last:center]"
        >
          {SCORE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <button
        disabled={submitting || isLocked || !hasFixture}
        onClick={onSubmit}
        className={`w-full rounded-lg px-4 py-3 bg-accent text-accent-foreground disabled:opacity-60 ${btnClassName}`}
      >
        {submitting ? "Submitting…" : "Confirm score"}
      </button>
    </div>
  );
}
