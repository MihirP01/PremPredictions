export const YEAR_TABLE_LOCK_AFTER_GW = 1;
export const YEAR_TABLE_SCORE_AFTER_GW = 38;

export type YearTableClub = {
  key: string;
  id?: number | null;
  name: string;
  tla?: string | null;
  shortName?: string | null;
  badge?: string | null;
  position?: number | null;
};

export function yearTableTeamKey(team: {
  id?: number | null;
  tla?: string | null;
  shortName?: string | null;
  name?: string | null;
}) {
  const id = Number(team.id);
  if (Number.isFinite(id) && id > 0) return String(id);
  const tla = String(team.tla || "")
    .trim()
    .toUpperCase();
  if (tla) return tla;
  return String(team.shortName || team.name || "")
    .trim()
    .toUpperCase();
}

export function yearTablePointsFor(predictedPos: number, actualPos: number) {
  const diff = Math.abs(predictedPos - actualPos);
  if (diff === 0) return 3;
  if (diff === 1) return 1;
  return 0;
}

export type YearTableClubScore = {
  key: string;
  predictedPos: number;
  actualPos: number | null;
  points: number;
};

export function scoreYearTableOrder(
  order: string[],
  actualPositionByKey: Map<string, number> | Record<string, number>,
): YearTableClubScore[] {
  const lookup =
    actualPositionByKey instanceof Map
      ? actualPositionByKey
      : new Map(
          Object.entries(actualPositionByKey).map(([key, pos]) => [
            key,
            Number(pos),
          ]),
        );
  return order.map((key, index) => {
    const predictedPos = index + 1;
    const actualPos = lookup.get(key);
    const hasActual = Number.isFinite(actualPos) && Number(actualPos) > 0;
    return {
      key,
      predictedPos,
      actualPos: hasActual ? Number(actualPos) : null,
      points: hasActual
        ? yearTablePointsFor(predictedPos, Number(actualPos))
        : 0,
    };
  });
}

export function yearTableTotal(rows: YearTableClubScore[]) {
  return rows.reduce(
    (sum, row) => sum + (Number.isFinite(row.points) ? row.points : 0),
    0,
  );
}

export function clubsFromTableRows(
  rows: Array<{
    position?: number;
    team?: {
      id?: number | null;
      name?: string;
      tla?: string | null;
      shortName?: string | null;
      badge?: string | null;
    };
  }>,
): YearTableClub[] {
  const clubs: YearTableClub[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const team = row.team || {};
    const key = yearTableTeamKey(team);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clubs.push({
      key,
      id: Number.isFinite(Number(team.id)) ? Number(team.id) : null,
      name: String(team.name || "Club"),
      tla: team.tla ?? null,
      shortName: team.shortName ?? null,
      badge: team.badge ?? null,
      position: Number.isFinite(Number(row.position))
        ? Number(row.position)
        : null,
    });
  }
  return clubs;
}
