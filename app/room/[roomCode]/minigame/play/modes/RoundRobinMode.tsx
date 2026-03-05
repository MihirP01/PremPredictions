import React from "react";
import { ScoreDesk, StatusDesk, TurnCounterCard } from "./ScoreDesk";

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
};

export function RoundRobinTurnIndicator({ turnNumber, totalTurns }: TurnProps) {
  return (
    <TurnCounterCard
      label="Player turn"
      current={turnNumber}
      total={totalTurns}
    />
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
}: ActionProps) {
  if (!amITurn) {
    return (
      <StatusDesk
        eyebrow="Turn status"
        title={
          waitingText ?? (
            <>
              Waiting for{" "}
              <span className="font-display text-foreground">
                {currentTurnName}
              </span>{" "}
              to pick...
            </>
          )
        }
        message="The round will advance as soon as the active player locks their score."
        latestLockedPick={latestLockedPick}
        modeLabel="Round robin"
        loading
      />
    );
  }

  return (
    <ScoreDesk
      eyebrow="Score desk"
      title="Submit your pick"
      description="Set the exact scoreline, then lock it into the round."
      modeLabel="Round robin"
      homeScore={homeScore}
      awayScore={awayScore}
      onHomeChange={onHomeChange}
      onAwayChange={onAwayChange}
      submitting={submitting}
      disabled={submitting || isLocked || !hasFixture}
      submitLabel="Confirm score"
      onSubmit={onSubmit}
    />
  );
}
