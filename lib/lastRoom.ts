import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";

const LAST_ROOM_KEY = "pl-predictions-last-room";

export function peekLastRoomCode() {
  if (typeof window === "undefined") return "";
  try {
    const code = canonicalRoomCode(
      window.localStorage.getItem(LAST_ROOM_KEY) || "",
    );
    return isValidRoomCode(code) ? code : "";
  } catch {
    return "";
  }
}

export function rememberLastRoomCode(code: string) {
  const next = canonicalRoomCode(code);
  if (!isValidRoomCode(next) || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_ROOM_KEY, next);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearLastRoomCode() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // Ignore storage failures.
  }
}
