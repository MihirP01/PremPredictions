export type PowerupType = "ALL_IN" | "SAFETY_NET" | null;

export type FixtureScoreInput = {
  basePoints: number;
  isGolden: boolean;
  powerupType: PowerupType;
};

export function applyFixtureScoring(input: FixtureScoreInput) {
  const withGolden = input.basePoints * (input.isGolden ? 2 : 1);

  if (input.powerupType === "ALL_IN") {
    // All-In is all-or-nothing on exact score.
    return input.basePoints === 2 ? 6 : 0;
  }

  if (input.powerupType === "SAFETY_NET") {
    // Safety Net guarantees minimum 1 point on a miss.
    return withGolden === 0 ? 1 : withGolden;
  }

  return withGolden;
}

