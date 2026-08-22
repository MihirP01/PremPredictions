import { adminDb } from "../firebase-admin";

export type MemberRoom = { roomCode: string; role: "leader" | "member" };

export async function listMemberRooms(uid: string): Promise<MemberRoom[]> {
  const roomRefs = await adminDb.collection("rooms").listDocuments();
  if (!roomRefs.length) return [];

  const memberRooms: MemberRoom[] = [];
  for (let i = 0; i < roomRefs.length; i += 50) {
    const slice = roomRefs.slice(i, i + 50);
    const snaps = await adminDb.getAll(
      ...slice.map((roomRef) => adminDb.doc(`${roomRef.path}/players/${uid}`)),
    );
    snaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const role = String(snap.data()?.role || "member");
      memberRooms.push({
        roomCode: slice[index].id,
        role: role === "leader" ? "leader" : "member",
      });
    });
  }

  return memberRooms.sort((a, b) => a.roomCode.localeCompare(b.roomCode));
}

export async function listMemberRoomCodes(uid: string) {
  return (await listMemberRooms(uid)).map((room) => room.roomCode);
}
