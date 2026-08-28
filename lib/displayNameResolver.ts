import { authenticatedFetch } from "./authenticatedFetch";

type ResolveDisplayNameInput = {
  uid: string;
  email?: string | null;
  roomCode?: string | null;
};

export async function resolveDisplayName({
  email,
  roomCode,
}: ResolveDisplayNameInput): Promise<string> {
  const fallback = String(email || "").split("@")[0] || "Player";
  try {
    const params = new URLSearchParams();
    if (roomCode) params.set("roomCode", String(roomCode).toUpperCase());
    const response = await authenticatedFetch(`/api/user/profile?${params}`, {
      cache: "no-store",
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as { displayName?: string };
    return String(data.displayName || fallback);
  } catch {
    return fallback;
  }
}
