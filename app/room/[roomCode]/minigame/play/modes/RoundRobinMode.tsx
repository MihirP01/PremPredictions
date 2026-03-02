import React from "react";
import { Loader2 } from "lucide-react";

const SCORE_OPTIONS = Array.from({ length: 10 }, (_, idx) => String(idx));

type TurnProps = {
  turnNumber: number;
  totalTurns: number;
};

type ActionProps = {
  amITurn: boolean;
  currentTurnName: string;
  waitingText?: React.ReactNode;
  latestLockedPick: {
    fixtureId: number;
    score: string;
  } | null;
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

export function RoundRobinTurnIndicator({ turnNumber, totalTurns }: TurnProps) {
  return (
    <>
      <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
        Turn {turnNumber}
      </div>
      <div className="font-display text-sm tracking-wide text-muted">Out of {totalTurns}</div>
    </>
  );
}

export function RoundRobinActionPanel({
  amITurn,
  currentTurnName,
  waitingText,
  latestLockedPick,
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
  if (!amITurn) {
    return (
      <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground space-y-3">
        <div className="inline-flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {waitingText ?? (
              <>
                Waiting for <span className="font-display">{currentTurnName}</span> to pick…
              </>
            )}
          </span>
        </div>
        {latestLockedPick ? (
          <div className="rounded-lg border border-subtle bg-surface px-3 py-2 text-center">
            <div className="text-[11px] uppercase tracking-wide text-muted">Your pick</div>
            <div className="font-display text-base font-semibold text-foreground tabular-nums">
              {latestLockedPick.score.replace("-", "–")}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
      <div className="font-semibold text-foreground text-center">Your turn</div>

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
