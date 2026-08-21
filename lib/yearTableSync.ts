import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { YEAR_TABLE_LOCK_AFTER_GW } from "./yearTableScoring";

function yearTableMetaRef(roomCode: string, seasonKey: string) {
  return adminDb.doc(`rooms/${roomCode}/seasons/${seasonKey}/yearTable/meta`);
}

function yearTablePickRef(roomCode: string, seasonKey: string, uid: string) {
  return adminDb.doc(
    `rooms/${roomCode}/seasons/${seasonKey}/yearTable/meta/picks/${uid}`,
  );
}

export function isCompleteYearOrder(order: unknown): order is string[] {
  if (!Array.isArray(order) || order.length !== 20) return false;
  const seen = new Set<string>();
  for (const value of order) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function sameClubSet(order: string[], teamKeys: string[] | undefined) {
  if (!Array.isArray(teamKeys) || teamKeys.length !== 20) return true;
  const expected = new Set(teamKeys.map(String));
  if (expected.size !== 20) return false;
  return order.length === 20 && order.every((key) => expected.has(key));
}

export async function listMemberRoomCodes(uid: string) {
  const roomRefs = await adminDb.collection("rooms").listDocuments();
  if (!roomRefs.length) return [] as string[];
  const memberRooms: string[] = [];
  for (let i = 0; i < roomRefs.length; i += 50) {
    const slice = roomRefs.slice(i, i + 50);
    const snaps = await adminDb.getAll(
      ...slice.map((roomRef) =>
        adminDb.doc(`${roomRef.path}/players/${uid}`),
      ),
    );
    snaps.forEach((snap, index) => {
      if (snap.exists) memberRooms.push(slice[index].id);
    });
  }
  return memberRooms;
}

export async function syncYearTableAcrossRooms(args: {
  uid: string;
  seasonKey: string;
  sourceRoomCode?: string;
  sourceOrder?: string[];
}) {
  const memberRooms = await listMemberRoomCodes(args.uid);
  if (!memberRooms.length) return { copiedTo: [] as string[] };

  let sourceOrder =
    args.sourceOrder && isCompleteYearOrder(args.sourceOrder)
      ? args.sourceOrder.map(String)
      : null;
  let sourceTeamKeys: string[] | undefined;
  let sourceSubmittedAt: unknown;
  let sourceRoom = args.sourceRoomCode || "";

  async function loadRoomSource(roomCode: string) {
    const [metaSnap, pickSnap] = await Promise.all([
      yearTableMetaRef(roomCode, args.seasonKey).get(),
      yearTablePickRef(roomCode, args.seasonKey, args.uid).get(),
    ]);
    const order = pickSnap.data()?.order;
    if (!isCompleteYearOrder(order)) return false;
    const meta = metaSnap.data() as { teamKeys?: string[] } | undefined;
    if (!sourceOrder) sourceOrder = order.map(String);
    sourceTeamKeys = Array.isArray(meta?.teamKeys)
      ? meta.teamKeys.map(String)
      : sourceTeamKeys;
    sourceSubmittedAt = pickSnap.data()?.submittedAt ?? sourceSubmittedAt;
    sourceRoom = roomCode;
    return true;
  }

  if (sourceRoom) {
    await loadRoomSource(sourceRoom);
  }
  if (!sourceOrder) {
    for (const roomCode of memberRooms) {
      if (roomCode === sourceRoom) continue;
      if (await loadRoomSource(roomCode)) break;
    }
  }

  if (!sourceOrder) return { copiedTo: [] as string[] };

  const copiedTo: string[] = [];
  for (const roomCode of memberRooms) {
    const metaRef = yearTableMetaRef(roomCode, args.seasonKey);
    const pickRef = yearTablePickRef(roomCode, args.seasonKey, args.uid);
    const [metaSnap, pickSnap] = await Promise.all([
      metaRef.get(),
      pickRef.get(),
    ]);
    if (pickSnap.exists && isCompleteYearOrder(pickSnap.data()?.order)) continue;

    const meta = metaSnap.data() as { teamKeys?: string[] } | undefined;
    const destKeys = Array.isArray(meta?.teamKeys) && meta.teamKeys.length === 20
      ? meta.teamKeys.map(String)
      : sourceTeamKeys;
    if (!sameClubSet(sourceOrder, destKeys)) continue;

    await adminDb.runTransaction(async (tx) => {
      const [lockedMeta, lockedPick] = await Promise.all([
        tx.get(metaRef),
        tx.get(pickRef),
      ]);
      if (lockedPick.exists && isCompleteYearOrder(lockedPick.data()?.order)) {
        return;
      }
      const lockedKeys = Array.isArray(lockedMeta.data()?.teamKeys)
        ? lockedMeta.data()?.teamKeys.map(String)
        : destKeys;
      if (!lockedMeta.exists || !Array.isArray(lockedMeta.data()?.teamKeys)) {
        const teamKeys = lockedKeys?.length === 20 ? lockedKeys : sourceTeamKeys;
        if (teamKeys?.length === 20) {
          tx.set(
            metaRef,
            {
              teamKeys,
              lockAfterGw: YEAR_TABLE_LOCK_AFTER_GW,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: args.uid,
            },
            { merge: true },
          );
        }
      }
      tx.set(pickRef, {
        uid: args.uid,
        order: sourceOrder,
        submittedAt: sourceSubmittedAt || FieldValue.serverTimestamp(),
      });
    });
    copiedTo.push(roomCode);
  }

  return { copiedTo };
}
