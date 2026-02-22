"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "../../components/LogoutButton";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { useAuth } from "../../components/AuthProvider";
import { db } from "../../firebase";
import { resolveDisplayName } from "@/lib/displayNameResolver";

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
  const [kicked, setKicked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const kickedFlag = new URLSearchParams(window.location.search).get("kicked") === "1";
    setKicked(kickedFlag);
  }, []);

  // Load profile + joined rooms for quick switching/joining.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }

    (async () => {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.data();
      const resolvedDisplayName = await resolveDisplayName({
        uid: user.uid,
        email: user.email,
      });
      setDisplayName(resolvedDisplayName);

      const existing = String(data?.currentRoomCode || "").toUpperCase();
      setCurrentRoomCode(existing);
      if (existing) setRoomCode(existing);

      // Fast path for returning users: if saved room membership still exists, open it.
      if (existing) {
        try {
          const existingMembership = await getDoc(
            doc(db, "rooms", existing, "players", user.uid),
          );
          if (existingMembership.exists()) {
            const role = String(existingMembership.data()?.role || "member");
            setMemberRooms([
              {
                roomCode: existing,
                role: role === "leader" ? "leader" : "member",
              },
            ]);
            router.replace(`/room/${existing}`);
            return;
          }
        } catch {
          // Continue to room list lookup fallback below.
        }
      }

      setRoomsLoading(true);
      try {
        const roomsSnap = await getDocs(collection(db, "rooms"));
        const checks = await Promise.all(
          roomsSnap.docs.map(async (roomDoc) => {
            try {
              const membershipRef = doc(
                db,
                "rooms",
                roomDoc.id,
                "players",
                user.uid,
              );
              const membershipSnap = await getDoc(membershipRef);
              if (!membershipSnap.exists()) return null;
              const role = String(membershipSnap.data()?.role || "member");
              return {
                roomCode: roomDoc.id,
                role: role === "leader" ? "leader" : "member",
              } satisfies MemberRoom;
            } catch {
              return null;
            }
          }),
        );

        const joinedRooms = checks
          .filter((r): r is MemberRoom => r !== null)
          .sort((a, b) => a.roomCode.localeCompare(b.roomCode));
        setMemberRooms(joinedRooms);

        // Auto-open saved current room when still a valid joined room.
        if (existing && joinedRooms.some((r) => r.roomCode === existing)) {
          router.replace(`/room/${existing}`);
        }
      } catch {
        // Do not hard-fail the gate if list fetch is blocked by rules.
        setMemberRooms([]);
      } finally {
        setRoomsLoading(false);
      }
    })().catch(() => {
      setRoomsLoading(false);
      setError("Failed to load profile.");
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
      const password = window.prompt("Enter room password");
      if (password === null) {
        setBusy(false);
        return;
      }
      const res = await fetch("/api/room/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomCode: code,
          uid: user.uid,
          displayName,
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not join room.");

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
      const password = window.prompt("Set room password (leave blank for none)");
      if (password === null) {
        setBusy(false);
        return;
      }
      const trimmed = password.trim();
      if (trimmed) {
        const confirm = window.prompt("Confirm room password");
        if (confirm === null) {
          setBusy(false);
          return;
        }
        if (trimmed !== confirm.trim()) {
          setError("Passwords do not match.");
          setBusy(false);
          return;
        }
      }
      const res = await fetch("/api/room/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          roomCode: code,
          uid: user.uid,
          displayName,
          password: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not create room.");
      router.replace(`/room/${code}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create room.");
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
        {kicked && (
          <div className="text-sm rounded-lg px-3 py-2 bg-surface-2 border border-teal-500 text-muted">
            You were removed from that room by the leader.
          </div>
        )}

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

        <div className="pt-1">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
