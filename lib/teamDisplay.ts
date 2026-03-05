export type TeamIdentity = {
  name?: string | null;
  tla?: string | null;
  shortName?: string | null;
};
import { deriveFallbackClubPla, resolveSeededClubPla } from "@/lib/clubPla";

function normalizeCode(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function teamAbbrFromParts(
  name?: string | null,
  tla?: string | null,
  shortName?: string | null,
) {
  const seededPla = resolveSeededClubPla(name, shortName);
  if (seededPla) return seededPla;

  const tlaCode = normalizeCode(tla);
  if (/^[A-Z0-9]{3,4}$/.test(tlaCode)) return tlaCode;

  const shortCode = normalizeCode(shortName);
  if (/^[A-Z0-9]{3,4}$/.test(shortCode)) return shortCode;

  return deriveFallbackClubPla(name, shortName);
}

export function teamAbbr(team: TeamIdentity) {
  return teamAbbrFromParts(team.name, team.tla, team.shortName);
}
