import React from "react";
import { TurnCounterCard } from "./ScoreDesk";

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
};

export function CaptainTurnIndicator({
  captainIsChoosingFixture,
  fixtureTurnNumber,
  fixtureTurnTotal,
  playerTurnNumber,
  playerTurnTotal,
}: CaptainTurnProps) {
  return (
    <TurnCounterCard
      label={captainIsChoosingFixture ? "Fixture turn" : "Player turn"}
      current={captainIsChoosingFixture ? fixtureTurnNumber : playerTurnNumber}
      total={captainIsChoosingFixture ? fixtureTurnTotal : playerTurnTotal}
    />
  );
}

export function CaptainBanner({ captainName }: BannerProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,18,32,0.94),rgba(7,12,22,0.96))] px-4 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <span className="font-display text-[0.62rem] uppercase tracking-[0.2em] text-muted/80">
        Captain
      </span>{" "}
      <span className="font-display font-semibold text-foreground">
        {captainName}
      </span>
    </div>
  );
}

export function CaptainChooseFixturePanel({
  submitting,
  isLocked,
  hasFixture,
  onSubmit,
}: ChooseFixtureProps) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,16,28,0.98),rgba(7,12,22,0.97))] p-4 text-foreground shadow-[0_18px_38px_rgba(4,8,16,0.28)] sm:p-5">
      <div className="font-display text-[0.65rem] uppercase tracking-[0.22em] text-muted/85">
        Selection control
      </div>
      <div className="space-y-1">
        <div className="mt-2 font-display text-[1.35rem] font-semibold leading-tight text-foreground">
          {hasFixture ? "Fixture Selected" : "Choose Fixture"}
        </div>
        <div className="text-sm text-muted">
          {hasFixture
            ? "Lock the highlighted fixture to start this round."
            : "Tap one fixture above, then lock it in to continue."}
        </div>
      </div>
      <button
        disabled={submitting || isLocked || !hasFixture}
        onClick={onSubmit}
        className="mt-4 w-full rounded-[18px] border border-amber-200/12 bg-[linear-gradient(90deg,rgba(78,56,33,0.88),rgba(52,42,34,0.82),rgba(78,56,33,0.88))] px-4 py-3 font-display text-base font-semibold tracking-[0.12em] text-foreground shadow-[0_16px_28px_rgba(40,24,10,0.22)] transition hover:border-amber-200/18 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Locking fixture…" : "Lock selected fixture"}
      </button>
    </div>
  );
}
