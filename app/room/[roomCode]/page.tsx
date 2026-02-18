"use client";

import LogoutButton from "../../../components/LogoutButton"; // adjust relative path
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "../../../components/AuthProvider";
import { db } from "../../../firebase";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

type Player = {
  uid: string;
  displayName: string;
  nickName?: string;
  role: "leader" | "member";
};
type PlayerDoc = {
  displayName?: string;
  nickName?: string;
  role?: "leader" | "member";
};
type MemberRoom = { roomCode: string; role: "leader" | "member" };
type RoomDoc = {
  leaderUid?: string;
  settings?: {
    sameResultLock?: boolean;
    themeAccent?: string;
  };
};

const THEME_ACCENT_OPTIONS = [
  { value: "teal", label: "Teal" },
  { value: "blue", label: "Blue" },
  { value: "emerald", label: "Emerald" },
  { value: "orange", label: "Orange" },
  { value: "rose", label: "Rose" },
  { value: "slate", label: "Slate" },
] as const;

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
  const [sameResultLock, setSameResultLock] = useState(true);
  const [themeAccent, setThemeAccent] = useState<string>("teal");
  const [roomSettingsBusy, setRoomSettingsBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [nickNameDraft, setNickNameDraft] = useState("");
  const [nickNameBusy, setNickNameBusy] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);

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
      const roomData = roomSnap.data() as RoomDoc;
      setLeaderUid(roomData?.leaderUid ?? null);
      setSameResultLock(roomData?.settings?.sameResultLock !== false);
      setThemeAccent(String(roomData?.settings?.themeAccent || "teal"));

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
            nickName: typeof data.nickName === "string" ? data.nickName.trim() : "",
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

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (settingsWrapRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [settingsOpen]);

  const isLeader = !!user && leaderUid === user.uid;
  const me = players.find((p) => p.uid === user?.uid) ?? null;
  const myDisplayName =
    me?.displayName ||
    user?.email?.split("@")[0] ||
    "Player";
  const myNickName = me?.nickName || "";

  useEffect(() => {
    setNickNameDraft(myNickName);
  }, [myNickName]);

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

  async function toggleSameResultLock() {
    if (!user || !isLeader || roomSettingsBusy) return;
    const nextValue = !sameResultLock;
    setRoomSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          sameResultLock: nextValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update settings.");
      setSameResultLock(nextValue);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update settings.");
    } finally {
      setRoomSettingsBusy(false);
    }
  }

  async function updateThemeAccent(nextAccent: string) {
    if (!user || !isLeader || roomSettingsBusy) return;
    setRoomSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          themeAccent: nextAccent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update settings.");
      setThemeAccent(nextAccent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update settings.");
    } finally {
      setRoomSettingsBusy(false);
    }
  }

  async function saveNickName() {
    if (!user || nickNameBusy) return;
    const trimmed = nickNameDraft.trim();
    if (trimmed.length > 20) {
      setError("Nickname must be 20 characters or less.");
      return;
    }
    setNickNameBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(db, "rooms", roomCode, "players", user.uid),
        {
          nickName: trimmed ? trimmed : deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update nickname.");
    } finally {
      setNickNameBusy(false);
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
          <div ref={settingsWrapRef} className="relative page-actions-enter">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex items-center justify-center page-action-btn"
              data-action="settings"
              aria-label="Open settings"
            >
              <Settings size={16} />
            </button>
              {settingsOpen && (
                <div className="absolute top-0 right-[calc(100%+12px)] w-60 sm:w-72 rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-2 shadow-card z-20 settings-panel-enter">
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
                <div className="rounded-lg border border-teal-500 p-2 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                    Change Nickname
                  </div>
                  <div>
                    <input
                      value={nickNameDraft}
                      onChange={(e) => setNickNameDraft(e.target.value)}
                      maxLength={20}
                      placeholder="Nickname"
                      className="w-full rounded-lg px-3 py-2 bg-input border border-teal-500 text-foreground"
                    />
                  </div>
                  <button
                    onClick={saveNickName}
                    disabled={nickNameBusy}
                    className="w-full text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                  >
                    {nickNameBusy ? "Saving..." : "Save"}
                  </button>
                  <div className="text-xs text-muted">
                    Nickname shows across the room. Leave blank to use your name.
                  </div>
                </div>
                <div className="pt-1 border-t border-subtle">
                  <LogoutButton />
                </div>
                {isLeader ? (
                  <div className="rounded-lg border border-teal-500 p-3 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                      Leader Tools
                    </div>
                    <div className="rounded-lg border border-teal-500 p-2 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                        Room Rules
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted">Theme Accent</div>
                        <div className="relative">
                          <select
                            value={themeAccent}
                            onChange={(e) => updateThemeAccent(e.target.value)}
                            disabled={roomSettingsBusy}
                            className="w-full h-9 rounded-lg border border-teal-500 bg-surface text-foreground text-sm font-semibold px-8 text-center appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60"
                          >
                            {THEME_ACCENT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                            ▼
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={toggleSameResultLock}
                        disabled={roomSettingsBusy}
                        className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
                      >
                        {roomSettingsBusy
                          ? "Saving..."
                          : sameResultLock
                            ? "Same Result Lock: ON"
                            : "Same Result Lock: OFF"}
                      </button>
                      <div className="text-xs text-muted">
                        ON: users cannot pick duplicate scores for the same fixture.
                      </div>
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

          <button
            onClick={() => router.push(`/room/${roomCode}/stats`)}
            className="text-sm bg-accent text-accent-foreground rounded-lg px-4 py-2 font-bold"
          >
            Stats
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
                <div className="font-medium text-foreground">
                  {p.nickName ? `(${p.nickName}) ${p.displayName}` : p.displayName}
                </div>

                {p.role === "leader" && (
                  <span className="text-xs px-2 py-1 rounded-full bg-surface border border-teal-500 text-muted">
                    Leader
                  </span>
                )}

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
