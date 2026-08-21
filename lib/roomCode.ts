export const ROOM_CODE_MIN = 4;
export const ROOM_CODE_MAX = 24;
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,24}$/;
export const ROOM_CODE_ERROR = "Room code must be 4–24 letters/numbers.";

export const ROOM_CODE_ALIASES: Record<string, string> = {
  PREM25: "KHUSHALSMELLS",
};

export function normalizeRoomCode(code: string) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

export function isValidRoomCode(code: string) {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(code));
}

export function canonicalRoomCode(code: string) {
  const normalized = normalizeRoomCode(code);
  return ROOM_CODE_ALIASES[normalized] || normalized;
}
