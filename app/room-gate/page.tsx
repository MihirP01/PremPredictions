"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, runTransaction, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../../components/AuthProvider";
import { db } from "../../firebase";

function normalize(code: string) {
  return code.trim().toUpperCase();
}
function valid(code: string) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

export default function RoomGatePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If user already has a room, go there
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    (async () => {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.data();

      setDisplayName(data?.displayName || user.email?.split("@")[0] || "Player");

      const existing = data?.currentRoomCode;
      if (existing) router.replace(`/room/${existing}`);
    })();
  }, [loading, user, router]);

  const joinRoom = async () => {
    if (!user) return;
    const code = normalize(roomCode);

    if (!valid(code)) {
      setError("Room code must be 4–8 letters/numbers.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const roomRef = doc(db, "rooms", code);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        setError("Room not found.");
        return;
      }

      // Add membership
      await setDoc(doc(db, "rooms", code, "players", user.uid), {
        displayName,
        role: "member",
        joinedAt: serverTimestamp(),
      });

      // Set user's current room
      await setDoc(
        doc(db, "users", user.uid),
        { displayName, currentRoomCode: code },
        { merge: true }
      );

      router.replace(`/room/${code}`);
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async () => {
    if (!user) return;
    const code = normalize(roomCode);

    if (!valid(code)) {
      setError("Room code must be 4–8 letters/numbers.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      // Transaction ensures uniqueness and sets leader atomically
      await runTransaction(db, async (tx) => {
        const roomRef = doc(db, "rooms", code);
        const roomSnap = await tx.get(roomRef);

        if (roomSnap.exists()) {
          throw new Error("ROOM_EXISTS");
        }

        tx.set(roomRef, {
          leaderUid: user.uid,
          createdAt: serverTimestamp(),
        });

        tx.set(doc(db, "rooms", code, "players", user.uid), {
          displayName,
          role: "leader",
          joinedAt: serverTimestamp(),
        });

        tx.set(doc(db, "users", user.uid), { displayName, currentRoomCode: code }, { merge: true });
      });

      router.replace(`/room/${code}`);
    } catch (e: any) {
      if (e?.message === "ROOM_EXISTS") setError("Room code already used.");
      else setError("Could not create room.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Join or Create a Room</h1>

        <div>
          <label className="text-sm text-gray-600">Display name</label>
          <input
            className="w-full border rounded-lg p-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm text-gray-600">Room code (4–8 A–Z / 0–9)</label>
          <input
            className="w-full border rounded-lg p-2 uppercase"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="AB12"
          />
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={joinRoom}
            className="flex-1 bg-black text-white rounded-lg p-2 disabled:opacity-60"
          >
            Join room
          </button>

          <button
            disabled={busy}
            onClick={createRoom}
            className="flex-1 border rounded-lg p-2 disabled:opacity-60"
          >
            Create room
          </button>
        </div>
      </div>
    </div>
  );
}
