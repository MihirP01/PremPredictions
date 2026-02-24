"use client";

import LogoutButton from "../../../components/LogoutButton"; // adjust relative path
import PageShell from "../../../components/PageShell";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, ChevronDown, ChevronUp, Gamepad2, Trophy } from "lucide-react";
import SectionCard from "../../../components/SectionCard";
import StatusPill from "../../../components/StatusPill";
import { ConfirmDialog, ModalHeader, ThemedModal } from "../../../components/RoomModal";
import TopActionRow from "../../../components/TopActionRow";
import { useAuth } from "../../../components/AuthProvider";
import { SettingsDropdownPanel, SettingsTriggerButton } from "../../../components/RoomSettingsMenu";
import SpecialBreak from "../../../components/SpecialBreak";
import { subscribeRoomMeta, subscribeRoomPlayers } from "@/lib/liveGameBus";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { db } from "../../../firebase";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

type Player = {
  uid: string;
  displayName: string;
  nickName?: string;
  role: "leader" | "member";
};
type MemberRoom = { roomCode: string; role: "leader" | "member" };

const THEME_ACCENT_OPTIONS = [
  { value: "teal", label: "Teal" },
  { value: "blue", label: "Blue" },
  { value: "emerald", label: "Emerald" },
  { value: "orange", label: "Orange" },
  { value: "rose", label: "Rose" },
  { value: "red", label: "Red" },
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
  const [kickBusy, setKickBusy] = useState(false);
  const [kickTarget, setKickTarget] = useState<Player | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [showKickControls, setShowKickControls] = useState(false);
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState(false);
  const [powerupsEnabled, setPowerupsEnabled] = useState(false);
  const [gameModeStyle, setGameModeStyle] = useState<"round_robin" | "sprint" | "captain">(
    "round_robin",
  );
  const [themeAccent, setThemeAccent] = useState<string>("teal");
  const [hasPassword, setHasPassword] = useState(false);
  const [roomSettingsBusy, setRoomSettingsBusy] = useState(false);
  const [roomRulesOpen, setRoomRulesOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
  const [newPasswordDraft, setNewPasswordDraft] = useState("");
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState("");
  const [nicknameExpanded, setNicknameExpanded] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [nickNameDraft, setNickNameDraft] = useState("");
  const [nickNameBusy, setNickNameBusy] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }

    let unsubPlayers: (() => void) | null = null;

    (async () => {
      // players listener
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cached.length) {
          const seeded: Player[] = cached.map((p) => ({
            uid: p.uid,
            displayName: p.displayName || "Player",
            nickName: typeof p.nickName === "string" ? p.nickName.trim() : "",
            role: p.role || "member",
          }));
          setPlayers(seeded);
        }
      } catch {
        // no-op
      }
      unsubPlayers = subscribeRoomPlayers(roomCode, (livePlayers) => {
        const list: Player[] = livePlayers
          .map((player) => ({
            uid: player.uid,
            displayName: player.displayName || "Player",
            nickName: typeof player.nickName === "string" ? player.nickName.trim() : "",
            role: player.role || "member",
          }))
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
          );
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
      if (roomRulesOpen) return;
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
  }, [settingsOpen, roomRulesOpen]);

  useEffect(() => {
    if (settingsOpen) return;
    setNicknameExpanded(false);
    setRoomRulesOpen(false);
  }, [settingsOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!roomRulesOpen) return;
    const scrollY = window.scrollY;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyWidth = document.body.style.width;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.width = prevBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [roomRulesOpen]);

  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => {
        if (!roomMeta) return;
        setLeaderUid(roomMeta.leaderUid);
        const style = roomMeta.settings.gameModeStyle;
        setGameModeStyle(style);
        setAllowIdenticalPicks(style === "sprint" ? true : !roomMeta.settings.sameResultLock);
        setPowerupsEnabled(roomMeta.settings.powerupsEnabled === true);
        setThemeAccent(roomMeta.settings.themeAccent);
        setHasPassword(roomMeta.settings.hasPassword);
      },
      () => {},
    );
  }, [roomCode]);

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
          try {
            const membershipRef = doc(db, "rooms", roomDoc.id, "players", user.uid);
            const membershipSnap = await getDoc(membershipRef);
            if (!membershipSnap.exists()) return null;
            const data = membershipSnap.data() as { role?: "leader" | "member" };
            return {
              roomCode: roomDoc.id,
              role: data.role === "leader" ? "leader" : "member",
            } satisfies MemberRoom;
          } catch {
            // Not a member or no read access to this room's players doc.
            return null;
          }
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
      const password = window.prompt("Enter room password");
      if (password === null) return;
      const res = await fetch("/api/room/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomCode: code,
          uid: user.uid,
          displayName: myDisplayName,
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to join room.");
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
      const password = window.prompt("Set room password (leave blank for none)");
      if (password === null) return;
      const trimmed = password.trim();
      if (trimmed) {
        const confirm = window.prompt("Confirm room password");
        if (confirm === null) return;
        if (trimmed !== confirm.trim()) {
          throw new Error("Passwords do not match.");
        }
      }
      const res = await fetch("/api/room/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          roomCode: code,
          uid: user.uid,
          displayName: myDisplayName,
          password: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create room.");
      setRoomSwitcherOpen(false);
      router.replace(`/room/${code}`);
    } catch (e) {
      setSwitcherError(e instanceof Error ? e.message : "Failed to create room.");
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function leaveCurrentRoom() {
    setLeaveConfirmOpen(true);
  }

  async function confirmLeaveCurrentRoom() {
    if (!user) return;
    setLeaveConfirmOpen(false);

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
    setDeleteConfirmOpen(true);
  }

  async function confirmDeleteRoomAsLeader() {
    if (!user || !isLeader) return;
    setDeleteConfirmOpen(false);

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

  async function confirmKickPlayer() {
    if (!user || !isLeader || !kickTarget) return;
    setKickBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, "rooms", roomCode, "players", kickTarget.uid));
      setKickTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove player.");
    } finally {
      setKickBusy(false);
    }
  }

  function openPasswordModal() {
    setPasswordError(null);
    setCurrentPasswordDraft("");
    setNewPasswordDraft("");
    setConfirmPasswordDraft("");
    setPasswordModalOpen(true);
  }

  async function saveRoomPassword() {
    if (!user || !isLeader) return;
    setPasswordBusy(true);
    setPasswordError(null);
    try {
      const res = await fetch("/api/room/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          currentPassword: currentPasswordDraft,
          newPassword: newPasswordDraft,
          confirmPassword: confirmPasswordDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save password.");
      setHasPassword(true);
      setPasswordModalOpen(false);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Failed to save password.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function toggleSameResultLock() {
    if (!user || !isLeader || roomSettingsBusy || gameModeStyle === "sprint") return;
    const nextAllowIdentical = !allowIdenticalPicks;
    setRoomSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          // server flag keeps legacy meaning: true => duplicates blocked
          sameResultLock: !nextAllowIdentical,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update settings.");
      const storedSameResultLock = data?.sameResultLock !== false;
      setAllowIdenticalPicks(!storedSameResultLock);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update settings.");
    } finally {
      setRoomSettingsBusy(false);
    }
  }

  async function updateGameModeStyle(nextStyle: "round_robin" | "sprint" | "captain") {
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
          gameModeStyle: nextStyle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update settings.");
      setGameModeStyle(nextStyle);
      setAllowIdenticalPicks(
        nextStyle === "sprint" ? true : !(data?.sameResultLock !== false),
      );
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

  async function togglePowerups() {
    if (!user || !isLeader || roomSettingsBusy) return;
    const nextEnabled = !powerupsEnabled;
    setRoomSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          powerupsEnabled: nextEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update settings.");
      setPowerupsEnabled(data?.powerupsEnabled === true);
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

  function toggleNicknameSection() {
    setNicknameExpanded((prev) => !prev);
  }

  const sortedPlayers = [...players].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
  const resultLockSubtext =
    gameModeStyle === "sprint"
      ? "Sprint • Allow Identical Picks OFF"
      : gameModeStyle === "captain"
        ? `Captain • Allow Identical Picks ${allowIdenticalPicks ? "ON" : "OFF"}`
        : `Round-Robin • Allow Identical Picks ${allowIdenticalPicks ? "ON" : "OFF"}`;

  return (
    <>
      <PageShell innerClassName="max-w-2xl mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="relative z-30">
          <TopActionRow
            title="Hub"
            subtitle={roomCode}
            actions={
              <div ref={settingsWrapRef} className="relative">
            <SettingsTriggerButton onClick={() => setSettingsOpen((v) => !v)} />
            <SettingsDropdownPanel open={settingsOpen}>
                <div className="font-display font-semibold text-foreground">Settings</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                    Change Nickname
                  </div>
                  <button
                    type="button"
                    onClick={toggleNicknameSection}
                    className="inline-flex items-center gap-1 rounded-lg border border-teal-500 bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-surface-2"
                  >
                    {nicknameExpanded ? "Collapse" : "Expand"}
                    {nicknameExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
                {nicknameExpanded && (
                  <div className="rounded-lg border border-teal-500 p-2 space-y-2">
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
                )}
              </div>
              <div className="space-y-2">
                <SpecialBreak />
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
                <LogoutButton />
                {isLeader && (
                  <div className="space-y-2">
                    <SpecialBreak />
                    <button
                      onClick={() => setRoomRulesOpen(true)}
                      className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
                    >
                      Room Settings
                    </button>
                  </div>
                )}
              </div>
            </SettingsDropdownPanel>
              </div>
            }
          />
        </div>

        <div className="hidden sm:grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: "Fixtures",
              hint: "Games & picks",
              href: `/room/${roomCode}/fixtures`,
              icon: CalendarDays,
            },
            {
              label: "Predictions",
              hint: "Mini-game",
              href: `/room/${roomCode}/minigame`,
              icon: Gamepad2,
            },
            {
              label: "Leaderboard",
              hint: "Room ranking",
              href: `/room/${roomCode}/leaderboard`,
              icon: Trophy,
            },
            {
              label: "Stats",
              hint: "Player form",
              href: `/room/${roomCode}/stats`,
              icon: BarChart3,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => router.push(item.href)}
                className="group rounded-xl border border-teal-500 bg-surface p-3 text-left hover:bg-surface-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground">{item.label}</span>
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-teal-500 bg-accent/15">
                    <Icon size={14} className="text-foreground" />
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">{item.hint}</div>
              </button>
            );
          })}
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <SectionCard>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-foreground">Players</div>
            {isLeader && (
              <button
                onClick={() => setShowKickControls((v) => !v)}
                className="text-xs rounded-lg px-3 py-1.5 bg-surface border border-teal-500 text-foreground hover:bg-surface-2"
              >
                {showKickControls ? "Hide Kick" : "Show Kick"}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {sortedPlayers.map((p) => (
              <div
                key={p.uid}
                className="min-h-10 flex items-center justify-between border-b border-subtle last:border-0 py-2"
              >
                <div className="min-w-0 flex-1 font-medium text-foreground">
                  <span className="font-display flex items-center gap-2">
                    <span className="block truncate">
                      {p.nickName ? `(${p.nickName}) ${p.displayName}` : p.displayName}
                    </span>
                    {p.uid === user?.uid && (
                      <StatusPill label="You" tone="you" className="shrink-0 text-[10px] py-0.5" />
                    )}
                  </span>
                </div>
                <div className="ml-2 w-[84px] h-6 flex items-center justify-end">
                  {p.role === "leader" ? (
                    <StatusPill label="Leader" tone="neutral" />
                  ) : isLeader && showKickControls && p.uid !== user?.uid ? (
                    <StatusPill label="Kick" tone="danger" onClick={() => setKickTarget(p)} />
                  ) : (
                    <StatusPill label="Kick" invisible />
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </PageShell>
      <ConfirmDialog
        open={!!kickTarget}
        onClose={() => (kickBusy ? null : setKickTarget(null))}
        onConfirm={confirmKickPlayer}
        title="Remove Player"
        body={
          <>
            Remove{" "}
            <span className="font-display text-foreground">
              {kickTarget?.nickName
                ? `(${kickTarget.nickName}) ${kickTarget.displayName}`
                : kickTarget?.displayName}
            </span>{" "}
            from room <span className="font-display text-foreground">{roomCode}</span>?
          </>
        }
        confirmLabel="Confirm Remove"
        confirming={kickBusy}
        danger
      />
      <ThemedModal
        open={roomSwitcherOpen}
        onClose={() => setRoomSwitcherOpen(false)}
        maxWidthClassName="max-w-lg"
      >
            <ModalHeader title="Switch Rooms" onClose={() => setRoomSwitcherOpen(false)} />

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
                    <span className="font-display">{r.roomCode}</span> {r.roomCode === roomCode ? "• Current" : ""}
                  </button>
                ))
              )}
            </div>
            <SpecialBreak />

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

            <div className="space-y-2">
              <SpecialBreak />
              <button
                onClick={leaveCurrentRoom}
                disabled={switcherBusy}
                className="w-full text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-danger hover:bg-surface-2 disabled:opacity-60"
              >
                Leave Current Room
              </button>
            </div>
      </ThemedModal>
      <ConfirmDialog
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        onConfirm={confirmLeaveCurrentRoom}
        title="Leave Room"
        body={
          <>
            Are you sure you want to leave{" "}
            <span className="font-display text-foreground">{roomCode}</span>?
          </>
        }
        confirmLabel="Confirm Leave"
        confirming={switcherBusy}
        danger
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDeleteRoomAsLeader}
        title="Delete Room"
        body={
          <>
            Delete room <span className="font-display text-foreground">{roomCode}</span> for
            everyone? This cannot be undone.
          </>
        }
        confirmLabel="Confirm Delete"
        confirming={deleteBusy}
        danger
      />
      <ThemedModal open={roomRulesOpen} onClose={() => setRoomRulesOpen(false)}>
            <ModalHeader
              title="Room Settings"
              onClose={() => setRoomRulesOpen(false)}
              ariaLabel="Exit room settings"
            />
            <button
              onClick={openPasswordModal}
              disabled={roomSettingsBusy}
              className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
            >
              {hasPassword ? "Change Password" : "Set Password"}
            </button>
            <div className="space-y-1">
              <div className="text-xs text-muted">Theme Accent</div>
              <div className="relative">
                <select
                  value={themeAccent}
                  onChange={(e) => updateThemeAccent(e.target.value)}
                  disabled={roomSettingsBusy}
                  className="w-full h-9 rounded-lg border border-teal-500 bg-surface text-foreground text-sm font-semibold px-8 text-center appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-[color:rgba(var(--room-accent-rgb),0.65)] disabled:opacity-60"
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
            <div className="space-y-1">
              <div className="text-xs text-muted">Game Mode</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => updateGameModeStyle("round_robin")}
                  disabled={roomSettingsBusy}
                  className={[
                    "w-full text-sm rounded-lg px-4 py-2 border disabled:opacity-60",
                    gameModeStyle === "round_robin"
                      ? "bg-[color:rgba(var(--room-accent-rgb),0.16)] border-[color:rgba(var(--room-accent-rgb),0.72)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.28)]"
                      : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
                  ].join(" ")}
                >
                  Round-Robin
                </button>
                <button
                  onClick={() => updateGameModeStyle("captain")}
                  disabled={roomSettingsBusy}
                  className={[
                    "w-full text-sm rounded-lg px-4 py-2 border disabled:opacity-60",
                    gameModeStyle === "captain"
                      ? "bg-[color:rgba(var(--room-accent-rgb),0.16)] border-[color:rgba(var(--room-accent-rgb),0.72)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.28)]"
                      : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
                  ].join(" ")}
                >
                  Captain
                </button>
                <button
                  onClick={() => updateGameModeStyle("sprint")}
                  disabled={roomSettingsBusy}
                  className={[
                    "w-full text-sm rounded-lg px-4 py-2 border disabled:opacity-60",
                    gameModeStyle === "sprint"
                      ? "bg-[color:rgba(var(--room-accent-rgb),0.16)] border-[color:rgba(var(--room-accent-rgb),0.72)] text-foreground shadow-[inset_0_0_0_1px_rgba(var(--room-accent-rgb),0.28)]"
                      : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
                  ].join(" ")}
                >
                  Sprint
                </button>
              </div>
              <div className="text-xs text-muted text-center">
                {gameModeStyle === "sprint"
                  ? "Sprint is the quickest mode for larger rooms."
                  : "Recommended for 5 or fewer players."}
              </div>
            </div>
            <button
              onClick={toggleSameResultLock}
              disabled={roomSettingsBusy || gameModeStyle === "sprint"}
              className={[
                "w-full text-sm rounded-lg px-4 py-2 border disabled:opacity-60",
                gameModeStyle === "sprint"
                  ? "bg-surface-2 border-subtle text-muted cursor-not-allowed"
                  : "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
              ].join(" ")}
            >
              {roomSettingsBusy
                ? "Saving..."
                : gameModeStyle === "sprint"
                  ? "Allow Identical Picks: ON (Sprint)"
                  : allowIdenticalPicks
                    ? "Allow Identical Picks: ON"
                    : "Allow Identical Picks: OFF"}
            </button>
            <div className="text-xs text-muted text-center">
              {resultLockSubtext}
            </div>
            <button
              onClick={togglePowerups}
              disabled={roomSettingsBusy}
              className={[
                "w-full text-sm rounded-lg px-4 py-2 border disabled:opacity-60",
                "bg-surface border-teal-500 text-foreground hover:bg-surface-2",
              ].join(" ")}
            >
              {roomSettingsBusy
                ? "Saving..."
                : powerupsEnabled
                  ? "Power-Ups: ON"
                  : "Power-Ups: OFF"}
            </button>
            <div className="text-xs text-muted text-center">
              Adds a Double Points phase after Golden for this week.
            </div>
            <div className="space-y-3">
              <SpecialBreak />
              <button
                onClick={deleteRoomAsLeader}
                disabled={deleteBusy}
                className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-danger hover:bg-surface-2 disabled:opacity-60"
              >
                {deleteBusy ? "Deleting room…" : "Delete Room"}
              </button>
            </div>
      </ThemedModal>
      <ThemedModal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)}>
            <ModalHeader
              title={hasPassword ? "Change Room Password" : "Set Room Password"}
              onClose={() => setPasswordModalOpen(false)}
              ariaLabel="Close password settings"
            />
            {hasPassword && (
              <div className="space-y-1">
                <label className="text-xs text-muted">Current Password</label>
                <input
                  type="password"
                  value={currentPasswordDraft}
                  onChange={(e) => setCurrentPasswordDraft(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 bg-input border border-teal-500 text-foreground"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-muted">New Password</label>
              <input
                type="password"
                value={newPasswordDraft}
                onChange={(e) => setNewPasswordDraft(e.target.value)}
                className="w-full rounded-lg px-3 py-2 bg-input border border-teal-500 text-foreground"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted">Confirm Password</label>
              <input
                type="password"
                value={confirmPasswordDraft}
                onChange={(e) => setConfirmPasswordDraft(e.target.value)}
                className="w-full rounded-lg px-3 py-2 bg-input border border-teal-500 text-foreground"
              />
            </div>
            {passwordError && (
              <div className="text-sm text-danger">{passwordError}</div>
            )}
            <button
              onClick={saveRoomPassword}
              disabled={passwordBusy}
              className="w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
            >
              {passwordBusy ? "Saving..." : hasPassword ? "Change Password" : "Set Password"}
            </button>
      </ThemedModal>
    </>
  );
}
