import React from "react";

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
    return (
      <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground space-y-3 text-center">
        <div className="font-semibold text-foreground">Locked In</div>
        {latestLockedPick && (
          <div className="text-sm text-muted">
            Your pick:{" "}
            <span className="font-display text-foreground font-semibold tabular-nums">
              {latestLockedPick.score.replace("-", "–")}
            </span>
          </div>
        )}
        <div className="w-full h-2 rounded-full border border-teal-500 bg-surface overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${lockedProgressPct}%` }}
          />
        </div>
        <div className="text-sm text-muted">Waiting for others... {playersLeftToLock} left.</div>
      </div>
    );
  }

  return (
    <div className="border border-teal-500 rounded-xl p-4 space-y-3 bg-surface-2">
      <div className="font-semibold text-foreground">Submit your pick</div>
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
