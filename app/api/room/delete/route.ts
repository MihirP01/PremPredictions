export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "../../../../firebase-admin";
import { isValidRoomCode } from "@/lib/roomCode";

type DeleteRoomBody = {
  roomCode?: string;
  leaderUid?: string;
};

type RoomDoc = {
  leaderUid?: string;
};

async function deleteCollectionDocs(path: string) {
  const snap = await adminDb.collection(path).get();
  if (snap.empty) return;
  const batch = adminDb.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function deleteSeasonData(roomCode: string, seasonKey: string) {
  const seasonBase = `rooms/${roomCode}/seasons/${seasonKey}`;
  const gamesSnap = await adminDb.collection(`${seasonBase}/games`).get();
  for (const gwDoc of gamesSnap.docs) {
    const base = `${seasonBase}/games/${gwDoc.id}`;
    await deleteCollectionDocs(`${base}/lobby`);
    await deleteCollectionDocs(`${base}/picks`);
    await deleteCollectionDocs(`${base}/golden`);
    await deleteCollectionDocs(`${base}/powerups`);
    await gwDoc.ref.delete();
  }

  const scoresSnap = await adminDb.collection(`${seasonBase}/scores`).get();
  for (const gwDoc of scoresSnap.docs) {
    await deleteCollectionDocs(`${seasonBase}/scores/${gwDoc.id}/users`);
    await gwDoc.ref.delete();
  }

  await deleteCollectionDocs(`${seasonBase}/yearTable/meta/picks`);
  await adminDb
    .doc(`${seasonBase}/yearTable/meta`)
    .delete()
    .catch(() => {});

  await adminDb
    .doc(`${seasonBase}`)
    .delete()
    .catch(() => {});
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DeleteRoomBody;
    const roomCode = String(body.roomCode || "").toUpperCase();
    const leaderUid = String(body.leaderUid || "");

    if (!isValidRoomCode(roomCode)) {
      return NextResponse.json({ error: "Bad roomCode" }, { status: 400 });
    }
    if (!leaderUid) {
      return NextResponse.json({ error: "Missing leaderUid" }, { status: 400 });
    }

    const roomRef = adminDb.doc(`rooms/${roomCode}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const roomData = roomSnap.data() as RoomDoc;
    if (roomData.leaderUid !== leaderUid) {
      return NextResponse.json({ error: "Not leader" }, { status: 403 });
    }

    // Track player ids so we can clear currentRoomCode where needed.
    const playersSnap = await adminDb
      .collection(`rooms/${roomCode}/players`)
      .get();
    const playerUids = playersSnap.docs.map((d) => d.id);

    // Delete seasonized game/score data.
    const seasonsSnap = await adminDb
      .collection(`rooms/${roomCode}/seasons`)
      .get();
    for (const seasonDoc of seasonsSnap.docs) {
      await deleteSeasonData(roomCode, seasonDoc.id);
      await seasonDoc.ref.delete();
    }

    // Backward compatibility: delete legacy non-seasonized paths.
    const gamesSnap = await adminDb.collection(`rooms/${roomCode}/games`).get();
    for (const gwDoc of gamesSnap.docs) {
      const base = `rooms/${roomCode}/games/${gwDoc.id}`;
      await deleteCollectionDocs(`${base}/lobby`);
      await deleteCollectionDocs(`${base}/picks`);
      await deleteCollectionDocs(`${base}/golden`);
      await deleteCollectionDocs(`${base}/powerups`);
      await gwDoc.ref.delete();
    }
    const scoresSnap = await adminDb
      .collection(`rooms/${roomCode}/scores`)
      .get();
    for (const gwDoc of scoresSnap.docs) {
      await deleteCollectionDocs(`rooms/${roomCode}/scores/${gwDoc.id}/users`);
      await gwDoc.ref.delete();
    }

    // Delete predictions tree if present.
    const predictionsSnap = await adminDb
      .collection(`rooms/${roomCode}/predictions`)
      .get();
    for (const gwDoc of predictionsSnap.docs) {
      await deleteCollectionDocs(
        `rooms/${roomCode}/predictions/${gwDoc.id}/items`,
      );
      await gwDoc.ref.delete();
    }

    // Delete players membership docs.
    if (!playersSnap.empty) {
      const batch = adminDb.batch();
      playersSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // Delete room doc last.
    await roomRef.delete();

    // Clear currentRoomCode for users who were in this room.
    if (playerUids.length > 0) {
      for (const uid of playerUids) {
        const userRef = adminDb.doc(`users/${uid}`);
        const userSnap = await userRef.get();
        if (!userSnap.exists) continue;
        const currentRoomCode = String(userSnap.data()?.currentRoomCode || "");
        if (currentRoomCode === roomCode) {
          await userRef.set({ currentRoomCode: null }, { merge: true });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
