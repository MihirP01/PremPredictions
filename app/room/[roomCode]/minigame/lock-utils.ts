export const ONE_HOUR_MS = 60 * 60 * 1000;
export type CountdownParts = {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

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

export function formatCountdown(msLeft: number) {
  const parts = getCountdownParts(msLeft);
  return `[${parts.days}dd] [${parts.hours}hr] [${parts.minutes}min] [${parts.seconds}sec]`;
}

export function getCountdownParts(msLeft: number): CountdownParts {
  if (msLeft <= 0) {
    return { days: "00", hours: "00", minutes: "00", seconds: "00" };
  }
  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}
