import { NextResponse } from "next/server";

const LEAGUE = "PL";
const EXPECTED_MATCHES_PER_GW = 10;

// YYYY-MM-DD in UTC
function fmt(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampGW(gw) {
  return Math.min(38, Math.max(1, gw));
}

export async function GET() {
  const API_KEY = process.env.FOOTBALLDATA_KEY;
  if (!API_KEY) {
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 },
    );
  }

  // Pull a window of matches around now + ahead to capture next GW(s).
  // Bigger forward window helps during breaks / sparse periods.
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 21); // past 3 weeks
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 35); // next 5 weeks

  const url =
    `https://api.football-data.org/v4/competitions/${LEAGUE}/matches` +
    `?dateFrom=${fmt(from)}&dateTo=${fmt(to)}`;

  const res = await fetch(url, {
    headers: { "X-Auth-Token": API_KEY },
    next: { revalidate: 300 }, // cache 5 min
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") || "11";
    return NextResponse.json(
      { error: "Rate limited", retryAfterSeconds: Number(retryAfter) || 11 },
      {
        status: 429,
        headers: { "Retry-After": retryAfter, "Cache-Control": "no-store" },
      },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("current-gameweek upstream error:", res.status, body);
    return NextResponse.json({ error: "Football API error" }, { status: 502 });
  }

  const data = await res.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];

  // Build per-matchday stats
  const byMd = new Map(); // md -> { total, finished, hasNonFinished }
  for (const m of matches) {
    const md = m?.matchday;
    if (!Number.isFinite(md)) continue;

    const status = m?.status;
    const entry = byMd.get(md) ?? { total: 0, finished: 0 };
    entry.total += 1;
    if (status === "FINISHED") entry.finished += 1;

    byMd.set(md, entry);
  }

  const matchdays = [...byMd.keys()].sort((a, b) => a - b);

  // Find the first matchday that is NOT fully finished.
  // “Fully finished” = at least EXPECTED matches AND all finished.
  let nextOpen = null;

  for (const md of matchdays) {
    const { total, finished } = byMd.get(md);

    // If we have matches for that matchday and not all are finished, it's still "open"
    if (finished < total) {
      nextOpen = md;
      break;
    }

    // If we have a full set and all finished, skip to next
    if (
      total >= EXPECTED_MATCHES_PER_GW &&
      finished >= EXPECTED_MATCHES_PER_GW
    ) {
      continue;
    }

    // If totals are weird (postponements / partial data), treat it as open
    // because from a UX perspective you probably still want to land here.
    nextOpen = md;
    break;
  }

  // If everything we can see is fully finished, advance to the next GW after max
  if (!Number.isFinite(nextOpen)) {
    const maxMd = matchdays.length ? Math.max(...matchdays) : 1;
    nextOpen = maxMd + 1;
  }

  nextOpen = clampGW(nextOpen);

  return NextResponse.json(
    {
      currentGameweek: nextOpen,
      debug: {
        window: { dateFrom: fmt(from), dateTo: fmt(to) },
        matchdaysSeen: matchdays.length,
      },
    },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } },
  );
}
