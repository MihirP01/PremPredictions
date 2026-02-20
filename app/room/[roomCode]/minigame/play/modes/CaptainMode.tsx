import React from "react";

type CaptainTurnProps = {
  captainIsChoosingFixture: boolean;
  fixtureTurnNumber: number;
  fixtureTurnTotal: number;
  playerTurnNumber: number;
  playerTurnTotal: number;
};

type BannerProps = {
  captainName: string;
};

type ChooseFixtureProps = {
  submitting: boolean;
  isLocked: boolean;
  hasFixture: boolean;
  onSubmit: () => void;
  btnClassName: string;
};

export function CaptainTurnIndicator({
  captainIsChoosingFixture,
  fixtureTurnNumber,
  fixtureTurnTotal,
  playerTurnNumber,
  playerTurnTotal,
}: CaptainTurnProps) {
  return (
    <>
      <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
        Turn {captainIsChoosingFixture ? fixtureTurnNumber : playerTurnNumber}
      </div>
      <div className="font-display text-sm tracking-wide text-muted">
        Out of {captainIsChoosingFixture ? fixtureTurnTotal : playerTurnTotal}
      </div>
    </>
  );
}

export function CaptainBanner({ captainName }: BannerProps) {
  return (
    <div className="border border-teal-500 rounded-xl p-3 bg-surface-2 text-center">
      <span className="text-xs text-muted uppercase tracking-wide">Captain</span>{" "}
      <span className="font-display font-semibold text-foreground">{captainName}</span>
    </div>
  );
}

export function CaptainChooseFixturePanel({
  submitting,
  isLocked,
  hasFixture,
  onSubmit,
  btnClassName,
}: ChooseFixtureProps) {
  return (
    <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 text-foreground space-y-3 text-center">
      <div className="font-semibold text-foreground">Choose fixture</div>
      <button
        disabled={submitting || isLocked || !hasFixture}
        onClick={onSubmit}
        className={`w-full rounded-lg px-4 py-3 bg-accent text-accent-foreground disabled:opacity-60 ${btnClassName}`}
      >
        {submitting ? "Locking fixture…" : "Lock fixture"}
      </button>
    </div>
  );
}
