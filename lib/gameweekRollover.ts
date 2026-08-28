export const GAMEWEEK_TIME_ZONE = "Europe/London";
export const PREDICTION_LOCK_WINDOW_MS = 30 * 60 * 1000;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const out: ZonedParts = {
    year: 1970,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };
  for (const part of parts) {
    if (part.type === "year") out.year = Number(part.value);
    else if (part.type === "month") out.month = Number(part.value);
    else if (part.type === "day") out.day = Number(part.value);
    else if (part.type === "hour") out.hour = Number(part.value);
    else if (part.type === "minute") out.minute = Number(part.value);
    else if (part.type === "second") out.second = Number(part.value);
  }
  return out;
}

function zonedDateTimeToUtc(parts: ZonedParts, timeZone: string) {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const actual = zonedParts(guess, timeZone);
  const actualAsUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
  );
  return guess + (guess - actualAsUtc);
}

export function nextLondonNoonMs(baseMs: number) {
  const local = zonedParts(baseMs, GAMEWEEK_TIME_ZONE);
  const nextDay = new Date(
    Date.UTC(local.year, local.month - 1, local.day + 1, 12),
  );
  return zonedDateTimeToUtc(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: 12,
      minute: 0,
      second: 0,
    },
    GAMEWEEK_TIME_ZONE,
  );
}
