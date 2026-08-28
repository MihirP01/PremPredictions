import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { canonicalRoomCode, isValidRoomCode } from "@/lib/roomCode";

export type MemberRoom = { roomCode: string; role: "leader" | "member" };

export type RoomAccessResolution = {
  currentRoomCode: string;
  displayName: string;
  rooms: MemberRoom[];
  indexReady: boolean;
};

const ROOM_ACCESS_TIMEOUT_MS = 3000;

function normalizeMemberRooms(
  rooms: Array<{ roomCode?: string; role?: string }> | undefined,
): MemberRoom[] {
  return (Array.isArray(rooms) ? rooms : [])
    .map((room) => {
      const roomCode = canonicalRoomCode(room?.roomCode);
      if (!isValidRoomCode(roomCode)) return null;
      return {
        roomCode,
        role: room?.role === "leader" ? "leader" : "member",
      } satisfies MemberRoom;
    })
    .filter((room): room is MemberRoom => room !== null);
}

async function postMemberships(
  body: Record<string, unknown>,
  timeoutMs?: number,
) {
  const controller = new AbortController();
  const timeoutId = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    return await authenticatedFetch("/api/room/memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function resolveRoomAccess(
  uid: string,
  preferredRoomCode = "",
): Promise<RoomAccessResolution> {
  const res = await postMemberships(
    { uid, mode: "fast", preferredRoomCode },
    ROOM_ACCESS_TIMEOUT_MS,
  );
  const data = (await res.json().catch(() => ({}))) as Partial<
    RoomAccessResolution & { error: string }
  >;
  if (!res.ok) throw new Error(data.error || "Failed to check room access.");
  return {
    currentRoomCode: canonicalRoomCode(data.currentRoomCode || ""),
    displayName: String(data.displayName || ""),
    rooms: normalizeMemberRooms(data.rooms),
    indexReady: data.indexReady === true,
  };
}

export async function fetchMemberRooms(uid: string): Promise<MemberRoom[]> {
  const res = await postMemberships({ uid, mode: "all" });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    rooms?: Array<{ roomCode?: string; role?: string }>;
  };
  if (!res.ok) throw new Error(data?.error || "Failed to load rooms.");

  return normalizeMemberRooms(data.rooms);
}
