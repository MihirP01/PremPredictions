export type PowerupType = "ALL_IN" | "SAFETY_NET" | null;
export type PredictionTier = "exact" | "result" | "miss";
export type PowerupVisualState = "powerup_hit" | "powerup_miss";

export type FixtureScoreInput = {
  basePoints: number;
  isGolden: boolean;
  powerupType: PowerupType;
};

type ParsedScore = { h: number; a: number };

function outcome(h: number, a: number) {
  if (h > a) return "H";
  if (h < a) return "A";
  return "D";
}

function parseScore(score: string | null | undefined): ParsedScore | null {
  const match = String(score || "")
    .trim()
    .match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return { h: Number(match[1]), a: Number(match[2]) };
}

export function getBasePointsFromScores(
  pred: string | null | undefined,
  actual: string | null | undefined,
) {
  const parsedPred = parseScore(pred);
  const parsedActual = parseScore(actual);
  if (!parsedPred || !parsedActual) return 0;
  if (parsedPred.h === parsedActual.h && parsedPred.a === parsedActual.a)
    return 2;
  if (
    outcome(parsedPred.h, parsedPred.a) ===
    outcome(parsedActual.h, parsedActual.a)
  ) {
    return 1;
  }
  return 0;
}

export function classifyPredictionTier(
  pred: string | null | undefined,
  actual: string | null | undefined,
): PredictionTier | null {
  const parsedActual = parseScore(actual);
  if (!parsedActual) return null;

  const parsedPred = parseScore(pred);
  if (!parsedPred) return "miss";

  if (parsedPred.h === parsedActual.h && parsedPred.a === parsedActual.a)
    return "exact";
  if (
    outcome(parsedPred.h, parsedPred.a) ===
    outcome(parsedActual.h, parsedActual.a)
  ) {
    return "result";
  }
  return "miss";
}

export function getPowerupVisualState(input: {
  powerupType: PowerupType;
  predictionTier: PredictionTier | null;
}): PowerupVisualState | null {
  if (!input.powerupType || input.predictionTier == null) return null;

  if (input.powerupType === "ALL_IN") {
    if (input.predictionTier === "exact") return "powerup_hit";
    if (input.predictionTier === "result") return "powerup_miss";
    return null;
  }

  return input.predictionTier === "miss" ? "powerup_hit" : null;
}

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
