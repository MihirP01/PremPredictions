import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

type ResolveDisplayNameInput = {
  uid: string;
  email?: string | null;
  roomCode?: string | null;
};

type RoomPlayerDoc = { displayName?: string; nickName?: string };
type UserDoc = { displayName?: string };

export async function resolveDisplayName({
  uid,
  email,
  roomCode,
}: ResolveDisplayNameInput): Promise<string> {
  const fallback = String(email || "").split("@")[0] || "Player";

  if (roomCode) {
    try {
      const roomPlayerSnap = await getDoc(
        doc(db, "rooms", String(roomCode).toUpperCase(), "players", uid),
      );
      if (roomPlayerSnap.exists()) {
        const roomData = roomPlayerSnap.data() as RoomPlayerDoc;
        const roomName =
          String(roomData?.nickName || "").trim() || roomData?.displayName;
        if (roomName) return roomName;
      }
    } catch {
      // fall through
    }
  }

  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const userData = userSnap.data() as UserDoc;
      if (userData?.displayName) return userData.displayName;
    }
  } catch {
    // fall through
  }

  return fallback;
}
