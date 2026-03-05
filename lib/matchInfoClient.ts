export type MatchInfoMiniTeam = {
  id: number | null;
  name: string;
  tla?: string | null;
  shortName?: string | null;
  badge?: string | null;
};

export type MatchInfoMiniMatch = {
  id: number | null;
  utcDate: string;
  homeTeam: MatchInfoMiniTeam;
  awayTeam: MatchInfoMiniTeam;
  competition?: {
    name: string;
    emblem?: string | null;
    code?: string | null;
  };
  result: string;
  status: string;
  form?: "W" | "D" | "L" | "—";
};

export type MatchInfoPlayer = {
  id: number | null;
  name: string;
  shirtNumber?: string | null;
  positionId?: number | null;
  photo?: string | null;
  layout?: {
    x?: number | null;
    y?: number | null;
  } | null;
  positionLabel?: string | null;
  rating?: number | null;
  goalCount?: number | null;
  ownGoalCount?: number | null;
  assistCount?: number | null;
  yellowCardCount?: number | null;
  redCardCount?: number | null;
  countryCode?: string | null;
  statusTags?: string[];
  substitutionEvents?: Array<{
    time?: number | null;
    type?: string | null;
  }>;
};

export type MatchInfoLineupTeam = {
  id: number | null;
  name: string;
  formation?: string | null;
  coach?: string | null;
  starters: MatchInfoPlayer[];
  subs: MatchInfoPlayer[];
  unavailable: MatchInfoPlayer[];
};

export type MatchInfoStat = {
  label: string;
  home: string;
  away: string;
  highlighted?: "home" | "away" | "equal" | null;
};

export type MatchInfoData = {
  fixtureId: number;
  generatedAt: string;
  liveWidgetUrl?: string | null;
  lineups: {
    phase?: "predicted" | "confirmed";
    home: MatchInfoLineupTeam;
    away: MatchInfoLineupTeam;
  };
  stats: MatchInfoStat[];
  headToHead: MatchInfoMiniMatch[];
  form: {
    home: MatchInfoMiniMatch[];
    away: MatchInfoMiniMatch[];
  };
};

const TTL_MS = 10 * 60 * 1000;
const STORAGE_PREFIX = "match-info:v4:";
const memCache = new Map<string, { expiresAt: number; data: MatchInfoData }>();
const pending = new Map<string, Promise<MatchInfoData>>();

function keyFor(fixtureId: number, seasonKey: string) {
  return `${String(seasonKey || "")}:fx:${String(fixtureId)}`;
}

function normalize(payload: unknown): MatchInfoData {
  const p = (payload || {}) as Partial<MatchInfoData>;
  return {
    fixtureId: Number(p.fixtureId ?? 0),
    generatedAt: String(p.generatedAt || ""),
    liveWidgetUrl: p.liveWidgetUrl ? String(p.liveWidgetUrl) : null,
    lineups: {
      phase: p.lineups?.phase === "predicted" ? "predicted" : "confirmed",
      home: {
        id: Number(p.lineups?.home?.id ?? 0) || null,
        name: String(p.lineups?.home?.name || "Home"),
        formation: p.lineups?.home?.formation
          ? String(p.lineups.home.formation)
          : null,
        coach: p.lineups?.home?.coach ? String(p.lineups.home.coach) : null,
        starters: Array.isArray(p.lineups?.home?.starters)
          ? p.lineups!.home.starters
          : [],
        subs: Array.isArray(p.lineups?.home?.subs) ? p.lineups!.home.subs : [],
        unavailable: Array.isArray(p.lineups?.home?.unavailable)
          ? p.lineups!.home.unavailable
          : [],
      },
      away: {
        id: Number(p.lineups?.away?.id ?? 0) || null,
        name: String(p.lineups?.away?.name || "Away"),
        formation: p.lineups?.away?.formation
          ? String(p.lineups.away.formation)
          : null,
        coach: p.lineups?.away?.coach ? String(p.lineups.away.coach) : null,
        starters: Array.isArray(p.lineups?.away?.starters)
          ? p.lineups!.away.starters
          : [],
        subs: Array.isArray(p.lineups?.away?.subs) ? p.lineups!.away.subs : [],
        unavailable: Array.isArray(p.lineups?.away?.unavailable)
          ? p.lineups!.away.unavailable
          : [],
      },
    },
    stats: Array.isArray(p.stats) ? p.stats : [],
    headToHead: Array.isArray(p.headToHead) ? p.headToHead : [],
    form: {
      home: Array.isArray(p.form?.home) ? p.form!.home : [],
      away: Array.isArray(p.form?.away) ? p.form!.away : [],
    },
  };
}

function getStorage(key: string): MatchInfoData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      data?: MatchInfoData;
    };
    if (!parsed?.data || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return normalize(parsed.data);
  } catch {
    return null;
  }
}

function setStorage(key: string, data: MatchInfoData) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({ expiresAt: Date.now() + TTL_MS, data }),
    );
  } catch {
    // ignore storage failures
  }
}

function setCached(key: string, data: MatchInfoData) {
  memCache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  setStorage(key, data);
}

export async function getMatchInfoCached(args: {
  fixtureId: number;
  seasonKey: string;
  kickoff: string;
  homeTeam: {
    id?: number | null;
    name: string;
    tla?: string | null;
    shortName?: string | null;
  };
  awayTeam: {
    id?: number | null;
    name: string;
    tla?: string | null;
    shortName?: string | null;
  };
  force?: boolean;
}): Promise<MatchInfoData> {
  const id = Number(args.fixtureId);
  const sk = String(args.seasonKey || "");
  if (!Number.isFinite(id) || !sk) {
    throw new Error("Invalid fixture/season.");
  }

  const key = keyFor(id, sk);
  const now = Date.now();
  if (!args.force) {
    const mem = memCache.get(key);
    if (mem && mem.expiresAt > now) return mem.data;
    const stored = getStorage(key);
    if (stored) {
      memCache.set(key, { expiresAt: now + TTL_MS, data: stored });
      return stored;
    }
  }
  const runFetch = async () => {
    const params = new URLSearchParams({
      fixtureId: String(id),
      seasonKey: sk,
      kickoff: String(args.kickoff || ""),
      homeName: String(args.homeTeam?.name || ""),
      awayName: String(args.awayTeam?.name || ""),
    });
    if (args.homeTeam?.tla) params.set("homeTla", String(args.homeTeam.tla));
    if (args.homeTeam?.shortName)
      params.set("homeShortName", String(args.homeTeam.shortName));
    if (args.awayTeam?.tla) params.set("awayTla", String(args.awayTeam.tla));
    if (args.awayTeam?.shortName)
      params.set("awayShortName", String(args.awayTeam.shortName));
    if (args.force) params.set("_t", String(Date.now()));
    const res = await fetch(`/api/match-info?${params.toString()}`, {
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as MatchInfoData & {
      error?: string;
    };
    if (!res.ok) throw new Error(body?.error || `match-info ${res.status}`);
    const normalized = normalize(body);
    if (!args.force) {
      setCached(key, normalized);
    }
    return normalized;
  };

  if (args.force) {
    return runFetch();
  }

  const existing = pending.get(key);
  if (existing) return existing;

  const req = runFetch().finally(() => pending.delete(key));

  pending.set(key, req);
  return req;
}
