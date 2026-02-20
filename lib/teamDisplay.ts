export type TeamIdentity = {
  name?: string | null;
  tla?: string | null;
  shortName?: string | null;
};

function normalizeCode(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

export function teamAbbrFromParts(
  name?: string | null,
  tla?: string | null,
  shortName?: string | null,
) {
  const tlaCode = normalizeCode(tla);
  if (/^[A-Z0-9]{2,4}$/.test(tlaCode)) return tlaCode;

  const shortCode = normalizeCode(shortName);
  if (/^[A-Z0-9]{2,4}$/.test(shortCode)) return shortCode;

  const clean = normalizeCode(name);
  if (!clean) return "FC";

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("");
  }
  return clean.slice(0, 3);
}

export function teamAbbr(team: TeamIdentity) {
  return teamAbbrFromParts(team.name, team.tla, team.shortName);
}
