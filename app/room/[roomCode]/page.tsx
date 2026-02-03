"use client";

import LogoutButton from "../../../components/LogoutButton"; // adjust relative path
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "../../../components/AuthProvider";
import { db } from "../../../firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

type Player = { uid: string; displayName: string; role: "leader" | "member" };
type PlayerDoc = { displayName?: string; role?: "leader" | "member" };
type MemberRoom = { roomCode: string; role: "leader" | "member" };

function normalizeRoomCode(code: string) {
  return code.trim().toUpperCase();
}

function validRoomCode(code: string) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

export default function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );

  const { user, loading } = useAuth();
  const router = useRouter();

  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomSwitcherOpen, setRoomSwitcherOpen] = useState(false);
  const [memberRooms, setMemberRooms] = useState<MemberRoom[]>([]);
  const [switcherBusy, setSwitcherBusy] = useState(false);
  const [switcherError, setSwitcherError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createCode, setCreateCode] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    let unsubPlayers: (() => void) | null = null;

    (async () => {
      // ensure room exists
      const roomSnap = await getDoc(doc(db, "rooms", roomCode));
      if (!roomSnap.exists()) {
        router.replace("/room-gate");
        return;
      }
      setLeaderUid(roomSnap.data()?.leaderUid ?? null);

      // Guard: user must already be a room member (set via room-gate flow)
      const memberSnap = await getDoc(
        doc(db, "rooms", roomCode, "players", user.uid),
      );
      if (!memberSnap.exists()) {
        setError("You are not a member of this room.");
        router.replace("/room-gate");
        return;
      }

      // players listener
      const q = query(collection(db, "rooms", roomCode, "players"));
      unsubPlayers = onSnapshot(q, (snap) => {
        const list: Player[] = snap.docs.map((d) => {
          const data = d.data() as PlayerDoc;
          return {
            uid: d.id,
            displayName: data.displayName || "Player",
            role: data.role || "member",
          };
        });
        setPlayers(list);
      });
    })().catch(() => setError("Failed to load room."));

    return () => {
      if (unsubPlayers) unsubPlayers();
    };
  }, [loading, user, router, roomCode]);

  const isLeader = !!user && leaderUid === user.uid;
  const myDisplayName =
    players.find((p) => p.uid === user?.uid)?.displayName ||
    user?.email?.split("@")[0] ||
    "Player";

  async function loadMemberRooms() {
    if (!user) return;
    setSwitcherBusy(true);
    setSwitcherError(null);
    try {
      const roomsSnap = await getDocs(collection(db, "rooms"));
      const checks = await Promise.all(
        roomsSnap.docs.map(async (roomDoc) => {
          const membershipRef = doc(db, "rooms", roomDoc.id, "players", user.uid);
          const membershipSnap = await getDoc(membershipRef);
          if (!membershipSnap.exists()) return null;
          const data = membershipSnap.data() as { role?: "leader" | "member" };
          return {
            roomCode: roomDoc.id,
            role: data.role === "leader" ? "leader" : "member",
          } satisfies MemberRoom;
        }),
      );
      const rooms: MemberRoom[] = checks
        .filter((x): x is MemberRoom => x !== null)
        .sort((a, b) => a.roomCode.localeCompare(b.roomCode));
      setMemberRooms(rooms);
    } catch (e) {
      setSwitcherError(
        e instanceof Error ? e.message : "Failed to load your rooms.",
      );
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function switchToRoom(targetCode: string) {
    if (!user) return;
    setSwitcherBusy(true);
    setSwitcherError(null);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { currentRoomCode: targetCode },
        { merge: true },
      );
      setRoomSwitcherOpen(false);
      router.replace(`/room/${targetCode}`);
    } catch (e) {
      setSwitcherError(e instanceof Error ? e.message : "Failed to switch room.");
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function joinNewRoom() {
    if (!user) return;
    const code = normalizeRoomCode(joinCode);
    if (!validRoomCode(code)) {
      setSwitcherError("Room code must be 4–8 letters/numbers.");
      return;
    }

    setSwitcherBusy(true);
    setSwitcherError(null);
    try {
      const roomRef = doc(db, "rooms", code);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) throw new Error("Room not found.");

      await setDoc(
        doc(db, "rooms", code, "players", user.uid),
        {
          displayName: myDisplayName,
          role: "member",
          joinedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        doc(db, "users", user.uid),
        { currentRoomCode: code, displayName: myDisplayName },
        { merge: true },
      );
      setRoomSwitcherOpen(false);
      router.replace(`/room/${code}`);
    } catch (e) {
      setSwitcherError(e instanceof Error ? e.message : "Failed to join room.");
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function createNewRoom() {
    if (!user) return;
    const code = normalizeRoomCode(createCode);
    if (!validRoomCode(code)) {
      setSwitcherError("Room code must be 4–8 letters/numbers.");
      return;
    }

    setSwitcherBusy(true);
    setSwitcherError(null);
    try {
      await runTransaction(db, async (tx) => {
        const roomRef = doc(db, "rooms", code);
        const roomSnap = await tx.get(roomRef);
        if (roomSnap.exists()) throw new Error("Room code already used.");

        tx.set(roomRef, {
          leaderUid: user.uid,
          createdAt: serverTimestamp(),
        });
        tx.set(doc(db, "rooms", code, "players", user.uid), {
          displayName: myDisplayName,
          role: "leader",
          joinedAt: serverTimestamp(),
        });
        tx.set(
          doc(db, "users", user.uid),
          { currentRoomCode: code, displayName: myDisplayName },
          { merge: true },
        );
      });
      setRoomSwitcherOpen(false);
      router.replace(`/room/${code}`);
    } catch (e) {
      setSwitcherError(e instanceof Error ? e.message : "Failed to create room.");
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function leaveCurrentRoom() {
    if (!user) return;
    const ok = window.confirm(
      `Are you sure you want to leave room ${roomCode}?`,
    );
    if (!ok) return;

    setSwitcherBusy(true);
    setSwitcherError(null);
    try {
      await deleteDoc(doc(db, "rooms", roomCode, "players", user.uid));
      const remaining = memberRooms.filter((r) => r.roomCode !== roomCode);
      if (remaining.length > 0) {
        const next = remaining[0].roomCode;
        await setDoc(
          doc(db, "users", user.uid),
          { currentRoomCode: next },
          { merge: true },
        );
        setRoomSwitcherOpen(false);
        router.replace(`/room/${next}`);
        return;
      }

      await setDoc(
        doc(db, "users", user.uid),
        { currentRoomCode: null },
        { merge: true },
      );
      setRoomSwitcherOpen(false);
      router.replace("/room-gate");
    } catch (e) {
      setSwitcherError(e instanceof Error ? e.message : "Failed to leave room.");
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function deleteRoomAsLeader() {
    if (!user || !isLeader) return;
    const confirmDelete = window.confirm(
      `Delete room ${roomCode} for everyone? This cannot be undone.`,
    );
    if (!confirmDelete) return;

    setDeleteBusy(true);
    setError(null);
    setSwitcherError(null);
    try {
      const res = await fetch("/api/room/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, leaderUid: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete room.");
      }

      setSettingsOpen(false);
      setRoomSwitcherOpen(false);
      router.replace("/room-gate");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete room.";
      setError(msg);
      setSwitcherError(msg);
    } finally {
      setDeleteBusy(false);
    }
  }

  const sortedPlayers = [...players].sort((a, b) => {
    if (a.role === "leader") return -1;
    if (b.role === "leader") return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <div className="min-h-[100dvh] p-6 bg-app">
      <div className="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="relative z-30 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">
            Room: <span className="italic font-thin text-xl">{roomCode}</span>
          </h1>
          <div className="relative page-actions-enter">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex items-center justify-center page-action-btn"
              data-action="settings"
              aria-label="Open settings"
            >
              <Settings size={16} />
            </button>
              {settingsOpen && (
                <div className="absolute right-0 mt-2 w-60 sm:w-72 rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-2 shadow-card z-20 settings-panel-enter">
                  <div className="font-semibold text-foreground">Settings</div>
                <button
                  onClick={async () => {
                    setSettingsOpen(false);
                    setRoomSwitcherOpen(true);
                    await loadMemberRooms();
                  }}
                  className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
                >
                  Switch Rooms
                </button>
                <div className="pt-1 border-t border-subtle">
                  <LogoutButton />
                </div>
                {isLeader ? (
                  <div className="rounded-lg border border-teal-500 p-3 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                      Leader Tools
                    </div>
                    <button
                      onClick={deleteRoomAsLeader}
                      disabled={deleteBusy}
                      className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-danger hover:bg-surface-2 disabled:opacity-60"
                    >
                      {deleteBusy ? "Deleting room…" : "Delete Room"}
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-muted">
                    No room settings available for your role.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => router.push(`/room/${roomCode}/fixtures`)}
            className="text-sm bg-accent text-accent-foreground rounded-lg px-4 py-2 font-bold"
          >
            Fixtures
          </button>

          <button
            onClick={() => router.push(`/room/${roomCode}/minigame`)}
            className="text-sm bg-accent text-accent-foreground rounded-lg px-4 py-2 font-bold"
          >
            Predictions
          </button>

          <button
            onClick={() => router.push(`/room/${roomCode}/leaderboard`)}
            className="text-sm bg-accent text-accent-foreground rounded-lg px-4 py-2 font-bold"
          >
            Leaderboard
          </button>
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <div className="border border-teal-500 rounded-xl p-4 bg-surface-2">
          <div className="font-semibold mb-2 text-foreground">Players</div>
          <div className="space-y-2">
            {sortedPlayers.map((p) => (
              <div
                key={p.uid}
                className="flex items-center justify-between border-b border-subtle last:border-0 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="font-medium text-foreground">
                    {p.displayName}
                  </div>

                  {p.role === "leader" && (
                    <span
                      className="inline-flex items-center justify-center text-yellow-400"
                      title="Room leader"
                      aria-label="Room leader"
                    >
                      ★
                    </span>
                  )}
                </div>

              </div>
            ))}
          </div>
        </div>
      </div>
      {roomSwitcherOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-teal-500 bg-surface p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-foreground">
                Switch Rooms
              </div>
              <button
                onClick={() => setRoomSwitcherOpen(false)}
                className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
              >
                Stay in {roomCode}
              </button>
            </div>

            {switcherError && (
              <div className="text-sm text-danger">{switcherError}</div>
            )}

            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">
                Your Rooms
              </div>
              {switcherBusy ? (
                <div className="text-sm text-muted">Loading rooms…</div>
              ) : memberRooms.length === 0 ? (
                <div className="text-sm text-muted">No joined rooms found.</div>
              ) : (
                memberRooms.map((r) => (
                  <button
                    key={r.roomCode}
                    disabled={switcherBusy || r.roomCode === roomCode}
                    onClick={() => switchToRoom(r.roomCode)}
                    className="w-full text-left text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                  >
                    {r.roomCode} {r.roomCode === roomCode ? "• Current" : ""}
                  </button>
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">
                Join New Room
              </div>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="AB12"
                  className="flex-1 rounded-lg px-3 py-2 bg-input border border-teal-500 text-foreground uppercase"
                />
                <button
                  onClick={joinNewRoom}
                  disabled={switcherBusy}
                  className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                >
                  Join
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">
                Create New Room
              </div>
              <div className="flex gap-2">
                <input
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder="NEW25"
                  className="flex-1 rounded-lg px-3 py-2 bg-input border border-teal-500 text-foreground uppercase"
                />
                <button
                  onClick={createNewRoom}
                  disabled={switcherBusy}
                  className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                >
                  Create
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-subtle">
              <button
                onClick={leaveCurrentRoom}
                disabled={switcherBusy}
                className="w-full text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-danger hover:bg-surface-2 disabled:opacity-60"
              >
                Leave Current Room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
