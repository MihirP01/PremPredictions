export type MemberRoom = { roomCode: string; role: "leader" | "member" };

export async function fetchMemberRooms(uid: string): Promise<MemberRoom[]> {
  const res = await fetch("/api/room/memberships", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    rooms?: Array<{ roomCode?: string; role?: string }>;
  };
  if (!res.ok) throw new Error(data?.error || "Failed to load rooms.");

  return (Array.isArray(data.rooms) ? data.rooms : [])
    .map((room) => {
      const roomCode = String(room?.roomCode || "").trim();
      if (!roomCode) return null;
      return {
        roomCode,
        role: room?.role === "leader" ? "leader" : "member",
      } satisfies MemberRoom;
    })
    .filter((room): room is MemberRoom => room !== null);
}
