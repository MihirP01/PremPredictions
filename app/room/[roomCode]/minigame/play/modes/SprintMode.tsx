import React from "react";
import { ScoreDesk, StatusDesk, TurnCounterCard } from "./ScoreDesk";

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
};

export function SprintTurnIndicator({ turnNumber, totalTurns }: TurnProps) {
  return (
    <TurnCounterCard
      label="Player turn"
      current={turnNumber}
      total={totalTurns}
    />
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
}: ActionProps) {
  if (myLockedIn) {
    return (
      <StatusDesk
        eyebrow="Turn status"
        title="Locked in"
        message="Waiting for the rest of the room to finish this fixture."
        latestLockedPick={latestLockedPick}
        modeLabel={isCaptainMode ? "Captain" : "Sprint"}
        loading
        progressPct={lockedProgressPct}
        progressLabel={`Waiting for others... ${playersLeftToLock} left.`}
      />
    );
  }

  return (
    <ScoreDesk
      eyebrow="Score desk"
      title="Submit your pick"
      description="Lock your score before the round moves on."
      modeLabel={isCaptainMode ? "Captain" : "Sprint"}
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
