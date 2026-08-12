type FixtureApiItem = {
  fixtureId?: number;
  kickoff?: string;
  status?: string;
};

type FixturesApiResponse = {
  fixtures?: FixtureApiItem[];
};

const LOCK_WINDOW_MS = 30 * 60 * 1000;
const INELIGIBLE_DRAFT_STATUSES = new Set([
  "FINISHED",
  "FT",
  "IN_PLAY",
  "PAUSED",
  "POSTPONED",
  "SUSPENDED",
  "CANCELLED",
  "AWARDED",
]);

function coerceKickoffMs(value: unknown): number | null {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function getBaseUrl(req: Request) {
  const host = req.headers.get("host");
  const proto = host?.includes("localhost") ? "http" : "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export function coerceMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value instanceof Date) return value.getTime();

  if (value && typeof value === "object") {
    const ts = value as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };

    if (typeof ts.toMillis === "function") {
      try {
        return ts.toMillis();
      } catch {
        // fall through
      }
    }

    const seconds =
      typeof ts.seconds === "number"
        ? ts.seconds
        : typeof ts._seconds === "number"
          ? ts._seconds
          : null;
    const nanos =
      typeof ts.nanoseconds === "number"
        ? ts.nanoseconds
        : typeof ts._nanoseconds === "number"
          ? ts._nanoseconds
          : 0;

    if (seconds != null) {
      return seconds * 1000 + Math.floor(nanos / 1_000_000);
    }
  }

  return null;
}

export async function loadGwFixturesWithLockWindow(
  baseUrl: string,
  gw: number,
  seasonKey?: string,
) {
  const nowMs = Date.now();
  const params = new URLSearchParams({ gameweek: String(gw) });
  if (seasonKey) params.set("seasonKey", seasonKey);
  const fxRes = await fetch(`${baseUrl}/api/fixtures?${params.toString()}`, {
    cache: "no-store",
  });
  if (!fxRes.ok) throw new Error("Failed to load fixtures");

  const fxData = (await fxRes.json()) as FixturesApiResponse;
  const fixtures = Array.isArray(fxData.fixtures) ? fxData.fixtures : [];

  const eligibleFixtures = fixtures
    .filter((f) => {
      const status = String(f.status || "")
        .toUpperCase()
        .trim();
      if (INELIGIBLE_DRAFT_STATUSES.has(status)) return false;
      const kickoffMs = coerceKickoffMs(f.kickoff);
      if (kickoffMs != null && kickoffMs <= nowMs) return false;
      return true;
    })
    .sort((a, b) => {
      const ka = coerceKickoffMs(a.kickoff);
      const kb = coerceKickoffMs(b.kickoff);
      if (Number.isFinite(ka) && Number.isFinite(kb) && ka !== kb)
        return (ka as number) - (kb as number);
      const ia = Number(a.fixtureId);
      const ib = Number(b.fixtureId);
      if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib;
      return 0;
    });

  const fixtureIds = eligibleFixtures
    .map((f) => Number(f.fixtureId))
    .filter((n) => Number.isFinite(n));

  const kickoffTimes = eligibleFixtures
    .map((f) => coerceKickoffMs(f.kickoff))
    .filter((n) => n != null)
    .sort((a, b) => a - b);

  if (fixtureIds.length === 0) {
    throw new Error(
      "No eligible fixtures for this GW (played/postponed/cancelled).",
    );
  }
  if (kickoffTimes.length === 0) throw new Error("Fixtures missing kickoff");

  const firstKickoffMs = kickoffTimes[0];
  const lockAtMs = firstKickoffMs - LOCK_WINDOW_MS;

  return {
    fixtureIds,
    firstKickoffAt: new Date(firstKickoffMs),
    lockAt: new Date(lockAtMs),
  };
}
