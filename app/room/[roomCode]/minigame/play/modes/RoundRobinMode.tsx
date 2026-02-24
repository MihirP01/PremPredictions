import React from "react";
import { Loader2 } from "lucide-react";

type TurnProps = {
  turnNumber: number;
  totalTurns: number;
};

type ActionProps = {
  amITurn: boolean;
  currentTurnName: string;
  waitingText?: React.ReactNode;
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
      <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground">
        <span className="inline-flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {waitingText ?? (
              <>
                Waiting for <span className="font-display">{currentTurnName}</span> to pick…
              </>
            )}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
      <div className="font-semibold text-foreground text-center">Your turn</div>

      <div className="flex items-center justify-center gap-3">
        <input
          value={homeScore}
          onChange={(e) => onHomeChange(e.target.value)}
          className="font-display w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="0"
          inputMode="numeric"
        />
        <span className="text-2xl text-muted">-</span>
        <input
          value={awayScore}
          onChange={(e) => onAwayChange(e.target.value)}
          className="font-display w-16 h-16 text-center text-2xl rounded-lg bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="0"
          inputMode="numeric"
        />
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
