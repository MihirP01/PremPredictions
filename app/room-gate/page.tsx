"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import LogoutButton from "../../components/LogoutButton";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
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
    const kickedFlag =
      new URLSearchParams(window.location.search).get("kicked") === "1";
    setKicked(kickedFlag);
  }, []);

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
          // Continue to fallback lookup.
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

        if (existing && joinedRooms.some((r) => r.roomCode === existing)) {
          router.replace(`/room/${existing}`);
        }
      } catch {
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
        e instanceof Error
          ? e.message
          : "Could not open room. Please try again.";
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
      const password = window.prompt(
        "Set room password (leave blank for none)",
      );
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

  if (loading) {
    return (
      <div className="min-h-screen bg-app px-6 py-8">
        <div className="mx-auto flex min-h-[40vh] max-w-xl items-center justify-center rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] text-sm text-white/65 shadow-[0_24px_56px_rgba(3,8,20,0.4)]">
          <span className="inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading room access...
          </span>
        </div>
      </div>
    );
  }

  const fieldClassName =
    "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-foreground placeholder:text-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-white/16 focus:bg-white/[0.06]";

  return (
    <div className="min-h-screen bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(160deg,rgba(9,18,34,0.96),rgba(10,27,46,0.94)_55%,rgba(14,45,63,0.92))] px-6 py-8 shadow-[0_28px_70px_rgba(3,8,20,0.42)] sm:px-8 sm:py-10">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
          <div className="pointer-events-none absolute right-8 top-8 h-20 w-20 rounded-full bg-sky-300/8 blur-3xl" />
          <div className="relative z-[1] space-y-8">
            <div className="space-y-4">
              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/58">
                Room Access
              </div>
              <h1 className="max-w-md font-display text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[0.94] text-foreground">
                Get the right room loaded fast.
              </h1>
              <p className="max-w-md text-sm leading-7 text-white/62 sm:text-base">
                Existing membership, room creation, and switching all stay
                intact. This branch changes only the presentation and hierarchy.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-4">
                <div className="font-display text-sm font-semibold text-foreground">
                  Member Recall
                </div>
                <div className="mt-2 text-xs leading-6 text-white/55">
                  Returning users still reopen their active room through the
                  same membership rules.
                </div>
              </div>
              <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-4">
                <div className="font-display text-sm font-semibold text-foreground">
                  One Surface
                </div>
                <div className="mt-2 text-xs leading-6 text-white/55">
                  Joining, creating, and switching stay in one clean panel
                  without backend changes.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] p-5 shadow-[0_28px_70px_rgba(3,8,20,0.42)] sm:p-6 lg:p-8">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
          <div className="relative z-[1] space-y-5">
            <div className="space-y-2">
              <div className="font-display text-2xl font-semibold text-foreground">
                Join or create a room
              </div>
              <div className="text-sm leading-6 text-white/58">
                Everything below uses the existing production flow. The redesign
                only changes the control surface.
              </div>
            </div>

            {kicked ? (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                You were removed from that room by the leader.
              </div>
            ) : null}

            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 space-y-3">
              <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                Joined Rooms
              </div>
              {roomsLoading ? (
                <div className="inline-flex items-center gap-2 text-sm text-white/60">
                  <Loader2 size={14} className="animate-spin" />
                  Loading rooms...
                </div>
              ) : memberRooms.length === 0 ? (
                <div className="text-sm text-white/55">
                  You are not in any rooms yet.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {memberRooms.map((r) => (
                    <button
                      key={r.roomCode}
                      disabled={busy}
                      onClick={() => openJoinedRoom(r.roomCode)}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-white/16 hover:bg-white/[0.06] disabled:opacity-60"
                    >
                      {r.roomCode}
                      {r.roomCode === currentRoomCode ? " • Current" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Nickname
                </label>
                <input
                  className={fieldClassName}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Room Code
                </label>
                <input
                  className={`${fieldClassName} uppercase`}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="AB12"
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                disabled={busy}
                onClick={joinRoom}
                className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-[0_16px_28px_rgba(3,8,20,0.24)] transition disabled:opacity-60"
              >
                Join Room
              </button>
              <button
                disabled={busy}
                onClick={createRoom}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-foreground transition hover:border-white/16 hover:bg-white/[0.06] disabled:opacity-60"
              >
                Create Room
              </button>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-3">
              <LogoutButton />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
