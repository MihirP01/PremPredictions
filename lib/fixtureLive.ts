export type LiveTeam = {
  name?: string | null;
  shortName?: string | null;
  tla?: string | null;
};

export type LiveFixtureLike = {
  fixtureId?: number | null;
  kickoff: string;
  status?: string | null;
  result?: string | null;
  redCards?: { home: number; away: number } | null;
  home?: LiveTeam;
  away?: LiveTeam;
};

const VOIDED_FIXTURE_STATUSES = new Set([
  "POSTPONED",
  "SUSPENDED",
  "CANCELLED",
]);

const TEAM_ALIAS_MAP: Record<string, string[]> = {
  "tottenham hotspur": ["tottenham", "spurs"],
  "wolverhampton wanderers": ["wolves"],
  "manchester united": ["man utd", "manchester utd", "man united"],
  "manchester city": ["man city"],
  "newcastle united": ["newcastle"],
  "nottingham forest": ["forest", "nottm forest"],
  "brighton and hove albion": ["brighton"],
  "west ham united": ["west ham"],
  "afc bournemouth": ["bournemouth"],
  "leeds united": ["leeds"],
  "hull city": ["hull"],
  "coventry city": ["coventry"],
  "ipswich town": ["ipswich"],
};

export const MAX_LIVE_MS = (2 * 60 + 45) * 60 * 1000;
const MAX_AWAIT_RESULT_MS = 8 * 60 * 60 * 1000;
const KICKOFF_POLL_LEAD_MS = 2 * 60 * 1000;

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeScoreStr(value: unknown) {
  const m = cleanText(value).match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

export function hasFixtureScore(result?: string | null) {
  return Boolean(normalizeScoreStr(result));
}

export function normalizeTeamNameForCompare(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\butd\b/g, "united")
    .replace(/\bman\b/g, "manchester")
    .replace(/\b(fc|afc|cf|sc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamCandidates(team?: LiveTeam | null) {
  const base = [team?.name, team?.shortName, team?.tla]
    .map((value) => normalizeTeamNameForCompare(value))
    .filter(Boolean);
  const out = new Set(base);
  for (const name of base) {
    const aliases = TEAM_ALIAS_MAP[name];
    if (!aliases) continue;
    for (const alias of aliases) out.add(normalizeTeamNameForCompare(alias));
  }
  return out;
}

function teamsOverlap(a?: LiveTeam | null, b?: LiveTeam | null) {
  const left = teamCandidates(a);
  const right = teamCandidates(b);
  for (const name of left) {
    if (right.has(name)) return true;
  }
  return false;
}

export function fixtureTimeBucket(value: string) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
}

export function isFinalFixtureStatus(status?: string | null) {
  const s = cleanText(status).toUpperCase();
  return (
    s === "FINISHED" ||
    s === "FT" ||
    s.startsWith("FT ") ||
    s === "FULLTIME" ||
    s === "FULL_TIME" ||
    s.includes("FULL TIME") ||
    s === "AET" ||
    s === "PEN" ||
    s === "PENALTIES" ||
    s === "AWARDED" ||
    s === "POSTPONED" ||
    s === "CANCELLED"
  );
}

export function isScoredFixtureStatus(status?: string | null) {
  const s = cleanText(status).toUpperCase();
  return (
    s === "FINISHED" ||
    s === "FT" ||
    s.startsWith("FT ") ||
    s === "FULLTIME" ||
    s === "FULL_TIME" ||
    s.includes("FULL TIME") ||
    s === "AET" ||
    s === "PEN" ||
    s === "PENALTIES" ||
    s === "AWARDED"
  );
}

export function isVoidedFixtureStatus(status?: string | null) {
  return VOIDED_FIXTURE_STATUSES.has(cleanText(status).toUpperCase());
}

export function isExplicitLiveFixtureStatus(status?: string | null) {
  const raw = cleanText(status);
  const s = raw.toUpperCase();
  if (!raw) return false;
  if (s === "TIMED" || s === "SCHEDULED" || s === "NOT_STARTED" || s === "TBD")
    return false;
  if (isFinalFixtureStatus(s)) return false;
  return true;
}

export function isPastExpectedFullTime(
  fixture: { kickoff?: string | null },
  nowMs: number,
  maxLiveMs = MAX_LIVE_MS,
) {
  const kickoffMs = Date.parse(String(fixture.kickoff || ""));
  if (!Number.isFinite(kickoffMs)) return false;
  return nowMs - kickoffMs >= maxLiveMs;
}

function statusRank(status?: string | null) {
  if (isFinalFixtureStatus(status)) return 3;
  if (isExplicitLiveFixtureStatus(status)) return 2;
  return 1;
}

function isGenericLiveStatus(status?: string | null) {
  const s = cleanText(status).toUpperCase();
  return s === "IN_PLAY" || s === "LIVE" || s === "PAUSED";
}

function preferStatus(incoming?: string | null, previous?: string | null) {
  const incomingRank = statusRank(incoming);
  const previousRank = statusRank(previous);
  if (incomingRank > previousRank) return incoming || previous;
  if (incomingRank < previousRank) return previous || incoming;
  if (isGenericLiveStatus(incoming) && !isGenericLiveStatus(previous)) {
    return previous || incoming;
  }
  return incoming || previous;
}

export function isFixtureLiveWindow(
  fixture: LiveFixtureLike,
  nowMs: number,
) {
  const kickoffMs = Date.parse(String(fixture.kickoff || ""));
  if (!Number.isFinite(kickoffMs)) return false;
  if (kickoffMs > nowMs) return false;
  if (isFinalFixtureStatus(fixture.status)) return false;
  if (isVoidedFixtureStatus(fixture.status)) return false;
  if (hasFixtureScore(fixture.result) && isPastExpectedFullTime(fixture, nowMs))
    return false;
  return true;
}

export function fixtureNeedsScoreRefresh(
  fixture: LiveFixtureLike,
  nowMs: number,
) {
  if (isVoidedFixtureStatus(fixture.status)) return false;
  if (
    isScoredFixtureStatus(fixture.status) &&
    hasFixtureScore(fixture.result)
  ) {
    return false;
  }
  const kickoffMs = Date.parse(String(fixture.kickoff || ""));
  if (!Number.isFinite(kickoffMs)) return false;
  if (kickoffMs > nowMs + KICKOFF_POLL_LEAD_MS) return false;
  if (kickoffMs > nowMs) return true;
  return nowMs - kickoffMs <= MAX_AWAIT_RESULT_MS;
}

function findOverlayMatch<T extends LiveFixtureLike>(
  overlay: T[],
  fixture: LiveFixtureLike,
) {
  const kick = fixtureTimeBucket(fixture.kickoff);
  const sameKick = overlay.filter(
    (candidate) => fixtureTimeBucket(candidate.kickoff) === kick,
  );
  const matchTeams = (candidate: T) =>
    teamsOverlap(candidate.home, fixture.home) &&
    teamsOverlap(candidate.away, fixture.away);

  return (
    sameKick.find(matchTeams) || overlay.find(matchTeams) || null
  );
}

export function mergeFixtureLiveOverlay<T extends LiveFixtureLike>(
  prev: T[] | null,
  overlay: LiveFixtureLike[],
): T[] | null {
  if (!prev?.length || !overlay.length) return prev;

  return prev.map((fixture) => {
    const live = findOverlayMatch(overlay, fixture);
    if (!live) return fixture;

    const liveStatus = String(live.status || "").trim();
    const nextStatus = preferStatus(liveStatus, fixture.status);
    const liveResult = normalizeScoreStr(live.result) || live.result || null;

    return {
      ...fixture,
      status: nextStatus,
      result: liveResult ?? fixture.result ?? null,
      redCards: live.redCards ?? fixture.redCards ?? null,
    };
  });
}

export function mergeProviderFixtures<T extends LiveFixtureLike>(
  prev: T[] | null,
  next: T[],
): T[] {
  if (!prev?.length) return next;
  const prevById = new Map(
    prev
      .filter((fixture) => Number.isFinite(Number(fixture.fixtureId)))
      .map((fixture) => [Number(fixture.fixtureId), fixture]),
  );

  return next.map((fixture) => {
    const previous = prevById.get(Number(fixture.fixtureId));
    if (!previous) return fixture;
    const nextStatus = preferStatus(fixture.status, previous.status);
    return {
      ...fixture,
      status: nextStatus,
      result:
        normalizeScoreStr(fixture.result) ||
        fixture.result ||
        previous.result ||
        null,
      redCards: fixture.redCards ?? previous.redCards ?? null,
    };
  });
}
