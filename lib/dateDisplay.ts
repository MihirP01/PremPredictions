function ordinalSuffix(day: number) {
  if (day % 10 === 1 && day % 100 !== 11) return "st";
  if (day % 10 === 2 && day % 100 !== 12) return "nd";
  if (day % 10 === 3 && day % 100 !== 13) return "rd";
  return "th";
}

export function formatDateWithOrdinal(iso: string) {
  const dt = new Date(iso);
  const dayNum = dt.getDate();
  const suffix = ordinalSuffix(dayNum);
  const monthYear = dt.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
  return { dayNum, suffix, monthYear };
}

export function formatTime24(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatKickoffParts(iso: string) {
  const { dayNum, suffix, monthYear } = formatDateWithOrdinal(iso);
  return { dayNum, suffix, monthYear, time: formatTime24(iso) };
}

export function fixtureDayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fixtureDayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

export function formatDateTimeLabel(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatUnlockDateParts(ms: number) {
  const dt = new Date(ms);
  const day = dt.getDate();
  const suffix = ordinalSuffix(day);
  const monthYear = dt.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
  const time = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { day, suffix, monthYear, time };
}
