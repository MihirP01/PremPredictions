const SEASON_START_MONTH_UTC = 7; // August (0-indexed)

function twoDigit(n: number) {
  return String(n).padStart(2, "0");
}

export function inferSeasonKey(now: Date = new Date()) {
  const year = now.getUTCFullYear();
  const seasonStartYear =
    now.getUTCMonth() >= SEASON_START_MONTH_UTC ? year : year - 1;
  const yyStart = seasonStartYear % 100;
  const yyEnd = (seasonStartYear + 1) % 100;
  return `${twoDigit(yyStart)}${twoDigit(yyEnd)}`;
}

export function normalizeSeasonKey(input: unknown) {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!raw) return null;

  if (/^\d{4}$/.test(raw)) return raw;

  const slash = /^(\d{2})[\/-](\d{2})$/.exec(raw);
  if (slash) return `${slash[1]}${slash[2]}`;

  const long = /^(\d{4})[\/-]?(\d{2,4})$/.exec(raw);
  if (long) {
    const startYY = Number(long[1]) % 100;
    const endYY = Number(long[2]) % 100;
    return `${twoDigit(startYY)}${twoDigit(endYY)}`;
  }

  return null;
}

export function resolveSeasonKey(input: unknown) {
  return normalizeSeasonKey(input) ?? inferSeasonKey();
}

export function seasonStartYear(seasonKey: string) {
  const yy = Number(String(seasonKey).slice(0, 2));
  return 2000 + yy;
}
