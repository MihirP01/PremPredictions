"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import LogoutButton from "../../components/LogoutButton";
import { useAuth } from "../../components/AuthProvider";
import { peekLastRoomCode, rememberLastRoomCode } from "@/lib/lastRoom";
import { fetchMemberRooms, resolveRoomAccess } from "@/lib/memberRoomsClient";
import {
  ROOM_CODE_ERROR,
  canonicalRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "@/lib/roomCode";
import { authenticatedFetch } from "@/lib/authenticatedFetch";

type MemberRoom = { roomCode: string; role: "leader" | "member" };

export default function RoomGatePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [currentRoomCode, setCurrentRoomCode] = useState("");
  const [memberRooms, setMemberRooms] = useState<MemberRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [resolving, setResolving] = useState(true);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kicked] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("kicked") === "1";
  });

  const userUid = user?.uid ?? "";
  const userEmail = user?.email ?? null;

  useEffect(() => {
    if (loading) return;
    if (!userUid) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    const fallbackDisplayName =
      String(userEmail || "").split("@")[0] || "Player";

    const enterRoom = (code: string, existing: string, profileName: string) => {
      if (cancelled) return;
      rememberLastRoomCode(code);
      router.replace(`/room/${code}`);

      if (code !== existing) {
        void authenticatedFetch("/api/user/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: profileName, currentRoomCode: code }),
        }).catch(() => undefined);
      }
    };

    const loadAllRoomsInBackground = (existing: string, profileName: string) => {
      setRoomsLoading(true);
      void fetchMemberRooms(userUid)
        .then((joinedRooms) => {
          if (cancelled) return;
          setMemberRooms(joinedRooms);
          if (!kicked && joinedRooms.length === 1) {
            enterRoom(joinedRooms[0].roomCode, existing, profileName);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError(
              "Could not refresh joined rooms. You can still join or create a room.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setRoomsLoading(false);
        });
    };

    (async () => {
      setResolving(true);
      try {
        const last = !kicked ? peekLastRoomCode() : "";
        const resolution = await resolveRoomAccess(userUid, last);
        if (cancelled) return;
        const existing = canonicalRoomCode(resolution.currentRoomCode);
        const memberCodes = new Set(resolution.rooms.map((room) => room.roomCode));
        setDisplayName(resolution.displayName || fallbackDisplayName);
        setCurrentRoomCode(existing);
        setMemberRooms(resolution.rooms);
        if (existing) setRoomCode(existing);

        const target = !kicked
          ? (last && memberCodes.has(last) ? last : "") ||
            (existing && memberCodes.has(existing) ? existing : "") ||
            (resolution.rooms.length === 1 ? resolution.rooms[0].roomCode : "")
          : "";
        if (target) {
          enterRoom(target, existing, resolution.displayName || fallbackDisplayName);
          return;
        }

        setResolving(false);
        if (!resolution.indexReady) loadAllRoomsInBackground(existing, resolution.displayName || fallbackDisplayName);
      } catch {
        if (cancelled) return;
        setDisplayName(fallbackDisplayName);
        setResolving(false);
        loadAllRoomsInBackground("", fallbackDisplayName);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, userUid, userEmail, router, kicked]);

  const openJoinedRoom = async (targetRoomCode: string) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    rememberLastRoomCode(targetRoomCode);
    router.replace(`/room/${targetRoomCode}`);
    void authenticatedFetch("/api/user/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, currentRoomCode: targetRoomCode }),
    }).catch(() => undefined);
  };

  const joinRoom = async () => {
    if (!user) return;
    const code = canonicalRoomCode(roomCode);

    if (!isValidRoomCode(code)) {
      setError(ROOM_CODE_ERROR);
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
      const res = await authenticatedFetch("/api/room/access", {
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

      rememberLastRoomCode(code);
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
    const code = normalizeRoomCode(roomCode);

    if (!isValidRoomCode(code)) {
      setError(ROOM_CODE_ERROR);
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
      const res = await authenticatedFetch("/api/room/access", {
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
      rememberLastRoomCode(code);
      router.replace(`/room/${code}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create room.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || (user && resolving)) {
    return (
      <div className="min-h-screen bg-app px-6 py-8">
        <div className="mx-auto flex min-h-[40vh] max-w-xl items-center justify-center rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] text-sm text-white/65 shadow-[0_24px_56px_rgba(3,8,20,0.4)]">
          <span className="inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            {loading ? "Restoring your session..." : "Checking your rooms..."}
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
                  className={`${fieldClassName} uppercase tracking-[0.08em]`}
                  value={roomCode}
                  onChange={(e) => setRoomCode(normalizeRoomCode(e.target.value))}
                  placeholder="AB12"
                  maxLength={24}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
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
