"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "../../components/AuthProvider";
import { db } from "../../firebase";

function normalize(code: string) {
  return code.trim().toUpperCase();
}
function valid(code: string) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

type MemberRoom = { roomCode: string; role: "leader" | "member" };

export default function RoomGatePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [currentRoomCode, setCurrentRoomCode] = useState("");
  const [memberRooms, setMemberRooms] = useState<MemberRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load profile + joined rooms for quick switching/joining.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    (async () => {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.data();

      setDisplayName(
        data?.displayName || user.email?.split("@")[0] || "Player",
      );

      const existing = String(data?.currentRoomCode || "").toUpperCase();
      setCurrentRoomCode(existing);
      if (existing) setRoomCode(existing);

      setRoomsLoading(true);
      const roomsSnap = await getDocs(collection(db, "rooms"));
      const checks = await Promise.all(
        roomsSnap.docs.map(async (roomDoc) => {
          const membershipRef = doc(db, "rooms", roomDoc.id, "players", user.uid);
          const membershipSnap = await getDoc(membershipRef);
          if (!membershipSnap.exists()) return null;
          const role = String(membershipSnap.data()?.role || "member");
          return {
            roomCode: roomDoc.id,
            role: role === "leader" ? "leader" : "member",
          } satisfies MemberRoom;
        }),
      );

      const joinedRooms = checks
        .filter((r): r is MemberRoom => r !== null)
        .sort((a, b) => a.roomCode.localeCompare(b.roomCode));
      setMemberRooms(joinedRooms);
      setRoomsLoading(false);

      // Auto-open saved current room when still a valid joined room.
      if (existing && joinedRooms.some((r) => r.roomCode === existing)) {
        router.replace(`/room/${existing}`);
      }
    })().catch(() => {
      setRoomsLoading(false);
      setError("Failed to load room data.");
    });
  }, [loading, user, router]);

  const openJoinedRoom = async (targetRoomCode: string) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { displayName, currentRoomCode: targetRoomCode },
        { merge: true },
      );
      router.replace(`/room/${targetRoomCode}`);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not open room. Please try again.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

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
        { merge: true },
      );

      router.replace(`/room/${code}`);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Could not join room. Please try again.";
      setError(message);
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

        tx.set(
          doc(db, "users", user.uid),
          { displayName, currentRoomCode: code },
          { merge: true },
        );
      });

      router.replace(`/room/${code}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "ROOM_EXISTS")
        setError("Room code already used.");
      else setError("Could not create room.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-app">
      <div className="w-full max-w-lg bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <h1 className="text-2xl font-semibold text-foreground">
          Join or Create a Room
        </h1>

        <div className="space-y-2">
          <div className="text-sm text-muted">Your joined rooms</div>
          {roomsLoading ? (
            <div className="text-sm text-muted">Loading rooms…</div>
          ) : memberRooms.length === 0 ? (
            <div className="text-sm text-muted">
              You are not in any rooms yet.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {memberRooms.map((r) => (
                <button
                  key={r.roomCode}
                  disabled={busy}
                  onClick={() => openJoinedRoom(r.roomCode)}
                  className="rounded-lg px-3 py-2 bg-surface text-foreground border border-teal-500 hover:bg-surface-2 disabled:opacity-60"
                >
                  {r.roomCode}
                  {r.roomCode === currentRoomCode ? " • Current" : ""}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-sm text-muted">Display name</label>
          <input
            className="w-full rounded-lg p-2 bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm text-muted">
            Room code (4–8 A–Z / 0–9)
          </label>
          <input
            className="w-full rounded-lg p-2 uppercase bg-input text-foreground border border-teal-500 focus:outline-none focus:ring-2 focus:ring-accent"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="AB12"
          />
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={joinRoom}
            className="flex-1 rounded-lg p-2 bg-accent text-accent-foreground disabled:opacity-60"
          >
            Join room
          </button>

          <button
            disabled={busy}
            onClick={createRoom}
            className="flex-1 rounded-lg p-2 bg-surface text-foreground border border-teal-500 hover:bg-surface-2 disabled:opacity-60"
          >
            Create room
          </button>
        </div>
      </div>
    </div>
  );
}
