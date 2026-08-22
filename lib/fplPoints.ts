const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const LIVE_URL = (eventId: number) =>
  `https://fantasy.premierleague.com/api/event/${eventId}/live/`;
const BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
const LIVE_TTL_MS = 45 * 1000;
const FETCH_TIMEOUT_MS = 4000;

const FPL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const TEAM_ALIASES: Record<string, string[]> = {
  "tottenham hotspur": ["tottenham", "spurs"],
  "wolverhampton wanderers": ["wolves"],
  "manchester united": ["man utd", "manchester utd", "man united"],
  "manchester city": ["man city"],
  "newcastle united": ["newcastle"],
  "nottingham forest": ["forest", "nottm forest", "nott m forest"],
  "brighton and hove albion": ["brighton"],
  "west ham united": ["west ham"],
  "afc bournemouth": ["bournemouth"],
  "leeds united": ["leeds"],
};

type FplTeam = { id: number; name: string; short_name: string };
type FplEvent = { id: number; deadline_time?: string };
type FplElement = {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
};
type FplBootstrap = {
  teams?: FplTeam[];
  events?: FplEvent[];
  elements?: FplElement[];
};
type FplLive = {
  elements?: Array<{ id?: number; stats?: { total_points?: number } }>;
};

type CacheEntry<T> = { expiresAt: number; value: T };

export type FplLineupPlayer = {
  name: string;
  fplPoints?: number | null;
};

export type FplLineupTeam = {
  name?: string | null;
  starters: FplLineupPlayer[];
  subs: FplLineupPlayer[];
  unavailable: FplLineupPlayer[];
};

export type FplLineups = {
  home: FplLineupTeam;
  away: FplLineupTeam;
};

let bootstrapCache: CacheEntry<FplBootstrap> | null = null;
let bootstrapPending: Promise<FplBootstrap> | null = null;
const liveCache = new Map<number, CacheEntry<Map<number, number>>>();
const livePending = new Map<number, Promise<Map<number, number>>>();

function normalizeName(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bfc\b/g, "")
    .replace(/\bac\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamKeys(name: string, extra: string[] = []) {
  const keys = new Set<string>();
  const add = (raw: string) => {
    const next = normalizeName(raw);
    if (next) keys.add(next);
  };
  add(name);
  extra.forEach(add);
  for (const [full, aliases] of Object.entries(TEAM_ALIASES)) {
    const group = [full, ...aliases].map(normalizeName);
    if (group.some((key) => keys.has(key))) {
      group.forEach((key) => keys.add(key));
    }
  }
  return keys;
}

function namesOverlap(a: Set<string>, b: Set<string>) {
  for (const key of a) {
    if (b.has(key)) return true;
  }
  return false;
}

function lastToken(name: string) {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  return tokens[tokens.length - 1] || "";
}

function elementKeys(el: FplElement) {
  return teamKeys(`${el.first_name} ${el.second_name}`, [
    el.web_name,
    el.second_name,
    el.first_name,
  ]);
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: FPL_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`fpl ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getBootstrap() {
  const now = Date.now();
  if (bootstrapCache && bootstrapCache.expiresAt > now) {
    return bootstrapCache.value;
  }
  if (bootstrapPending) return bootstrapPending;
  bootstrapPending = fetchJson<FplBootstrap>(BOOTSTRAP_URL)
    .then((value) => {
      bootstrapCache = { value, expiresAt: Date.now() + BOOTSTRAP_TTL_MS };
      return value;
    })
    .finally(() => {
      bootstrapPending = null;
    });
  return bootstrapPending;
}

async function getLivePoints(eventId: number) {
  const now = Date.now();
  const cached = liveCache.get(eventId);
  if (cached && cached.expiresAt > now) return cached.value;
  const pending = livePending.get(eventId);
  if (pending) return pending;

  const req = fetchJson<FplLive>(LIVE_URL(eventId))
    .then((payload) => {
      const map = new Map<number, number>();
      for (const row of payload.elements || []) {
        const id = Number(row?.id);
        const points = Number(row?.stats?.total_points);
        if (Number.isFinite(id) && Number.isFinite(points)) {
          map.set(id, points);
        }
      }
      liveCache.set(eventId, {
        value: map,
        expiresAt: Date.now() + LIVE_TTL_MS,
      });
      return map;
    })
    .finally(() => {
      livePending.delete(eventId);
    });
  livePending.set(eventId, req);
  return req;
}

function eventForKickoff(events: FplEvent[], kickoff: string) {
  const kickoffMs = Date.parse(String(kickoff || ""));
  const sorted = [...events]
    .filter((event) => Number.isFinite(Number(event?.id)))
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!sorted.length) return null;
  if (!Number.isFinite(kickoffMs)) return sorted[0];

  let chosen = sorted[0];
  for (const event of sorted) {
    const deadlineMs = Date.parse(String(event.deadline_time || ""));
    if (!Number.isFinite(deadlineMs)) continue;
    if (deadlineMs <= kickoffMs) chosen = event;
    else break;
  }
  return chosen;
}

function findTeam(teams: FplTeam[], name: string) {
  const need = teamKeys(name);
  return (
    teams.find((team) =>
      namesOverlap(need, teamKeys(team.name, [team.short_name])),
    ) || null
  );
}

function webNameMatches(full: string, tokens: Set<string>, web: string) {
  if (!web) return false;
  if (full === web || tokens.has(web)) return true;
  const webTokens = web.split(" ").filter(Boolean);
  return webTokens.length > 0 && webTokens.every((token) => tokens.has(token));
}

function findElement(elements: FplElement[], playerName: string) {
  const full = normalizeName(playerName);
  const tokens = new Set(full.split(" ").filter(Boolean));

  const exact = elements.find((el) => {
    const fullName = normalizeName(`${el.first_name} ${el.second_name}`);
    const web = normalizeName(el.web_name);
    return full === fullName || webNameMatches(full, tokens, web);
  });
  if (exact) return exact;

  const last = lastToken(playerName);
  if (!last) return null;
  const lastHits = elements.filter((el) => {
    const keys = elementKeys(el);
    return tokens.has(last) && (keys.has(last) || namesOverlap(tokens, keys));
  });
  return lastHits.length === 1 ? lastHits[0] : null;
}

function pointsForPlayer(
  playerName: string,
  teamName: string,
  teams: FplTeam[],
  elements: FplElement[],
  livePoints: Map<number, number>,
) {
  const team = findTeam(teams, teamName);
  if (!team) return null;
  const squad = elements.filter((el) => el.team === team.id);
  const el = findElement(squad, playerName);
  if (!el) return null;
  if (!livePoints.has(el.id)) return null;
  return livePoints.get(el.id) ?? null;
}

function withPoints<T extends FplLineupPlayer>(
  player: T,
  teamName: string,
  teams: FplTeam[],
  elements: FplElement[],
  livePoints: Map<number, number>,
): T {
  return {
    ...player,
    fplPoints: pointsForPlayer(
      player.name,
      teamName,
      teams,
      elements,
      livePoints,
    ),
  };
}

function withTeamPoints<T extends FplLineupTeam>(
  team: T,
  fallbackName: string,
  teams: FplTeam[],
  elements: FplElement[],
  livePoints: Map<number, number>,
): T {
  const teamName = String(team.name || fallbackName || "");
  const apply = <P extends FplLineupPlayer>(list: P[]) =>
    list.map((player) =>
      withPoints(player, teamName, teams, elements, livePoints),
    );
  return {
    ...team,
    starters: apply(team.starters),
    subs: apply(team.subs),
    unavailable: apply(team.unavailable),
  };
}

export async function attachFplPointsToLineups<T extends FplLineups>(
  lineups: T,
  args: { kickoff: string; homeName?: string; awayName?: string },
): Promise<T> {
  try {
    const bootstrap = await getBootstrap();
    const teams = Array.isArray(bootstrap.teams) ? bootstrap.teams : [];
    const events = Array.isArray(bootstrap.events) ? bootstrap.events : [];
    const elements = Array.isArray(bootstrap.elements) ? bootstrap.elements : [];
    const event = eventForKickoff(events, args.kickoff);
    if (!event || !teams.length || !elements.length) return lineups;

    const livePoints = await getLivePoints(Number(event.id));
    return {
      ...lineups,
      home: withTeamPoints(
        lineups.home,
        String(args.homeName || ""),
        teams,
        elements,
        livePoints,
      ),
      away: withTeamPoints(
        lineups.away,
        String(args.awayName || ""),
        teams,
        elements,
        livePoints,
      ),
    };
  } catch {
    return lineups;
  }
}
