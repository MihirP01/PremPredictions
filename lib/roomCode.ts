export const ROOM_CODE_MIN = 4;
export const ROOM_CODE_MAX = 24;
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,24}$/;
export const ROOM_CODE_ERROR = "Room code must be 4–24 letters/numbers.";

export const ROOM_CODE_ALIASES: Record<string, string> = {
  PREM25: "KHUSHALSMELLS",
};

export function normalizeRoomCode(code: unknown) {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isValidRoomCode(code: unknown) {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(code));
}

export function canonicalRoomCode(code: unknown) {
  const normalized = normalizeRoomCode(code);
  return ROOM_CODE_ALIASES[normalized] || normalized;
}

export function roomCodeLookupCandidates(code: unknown) {
  const normalized = normalizeRoomCode(code);
  const aliased = canonicalRoomCode(normalized);
  return [...new Set([normalized, aliased].filter((value) => isValidRoomCode(value)))];
}
