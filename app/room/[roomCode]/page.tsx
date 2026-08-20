"use client";

import LogoutButton from "../../../components/LogoutButton"; // adjust relative path
import PageShell from "../../../components/PageShell";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Loader2,
  Trophy,
} from "lucide-react";
import SectionCard from "../../../components/SectionCard";
import StatusPill from "../../../components/StatusPill";
import {
  ConfirmDialog,
  ModalHeader,
  ThemedModal,
  ThemedSheetModal,
} from "../../../components/RoomModal";
import TopActionRow from "../../../components/TopActionRow";
import { useAuth } from "../../../components/AuthProvider";
import {
  SettingsDropdownPanel,
  SettingsTriggerButton,
} from "../../../components/RoomSettingsMenu";
import SpecialBreak from "../../../components/SpecialBreak";
import SectionGrid from "../../../components/SectionGrid";
import SectionStack from "../../../components/SectionStack";
import { subscribeRoomMeta, subscribeRoomPlayers } from "@/lib/liveGameBus";
import {
  getRoomBootstrapCached,
  patchRoomBootstrapCached,
  peekRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { getTableCached, type TableRow } from "@/lib/tableClient";
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

function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

type HubSummaryTileProps = {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  icon?: React.ReactNode;
};

function HubSummaryTile({ label, value, note, icon }: HubSummaryTileProps) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.014))] p-4 shadow-[0_14px_32px_rgba(3,8,20,0.14)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/46">
            {label}
          </div>
          <div className="font-display text-[clamp(1rem,1.8vw,1.6rem)] font-semibold leading-none text-foreground">
            {value}
          </div>
        </div>
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/75">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-3 text-xs text-muted">{note}</div>
    </div>
  );
}

type HubNavTileProps = {
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
};

function HubNavTile({ label, hint, icon: Icon, onClick }: HubNavTileProps) {
  return (
    <button
      onClick={onClick}
      className="group rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-4 text-left shadow-[0_14px_32px_rgba(3,8,20,0.14)] transition hover:-translate-y-0.5 hover:bg-white/[0.045]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-base font-semibold text-foreground">
            {label}
          </div>
          <div className="mt-1 text-xs text-muted">{hint}</div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/75 transition group-hover:border-white/14 group-hover:bg-white/[0.055]">
          <Icon size={16} />
        </div>
      </div>
    </button>
  );
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
  const [gameModeStyle, setGameModeStyle] = useState<
    "round_robin" | "sprint" | "captain" | "league"
  >("round_robin");
  const [leagueFairPlayEnabled, setLeagueFairPlayEnabled] = useState(false);
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
  const [seasonKey, setSeasonKey] = useState("");
  const [currentGw, setCurrentGw] = useState(1);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [tableRows, setTableRows] = useState<TableRow[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);
  const settingsModalTimerRef = useRef<number | null>(null);
  const activePhaseRedirectedRef = useRef(false);

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
            nickName:
              typeof player.nickName === "string" ? player.nickName.trim() : "",
            role: player.role || "member",
          }))
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, {
              sensitivity: "base",
            }),
          );
        setPlayers(list);
      });
    })().catch(() => setError("Failed to load room."));

    return () => {
      if (unsubPlayers) unsubPlayers();
    };
  }, [loading, user, router, roomCode]);

  // If a minigame is already in progress, jump returning users straight back in.
  useEffect(() => {
    if (loading || !user) return;
    if (activePhaseRedirectedRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const bootstrap = await getRoomBootstrapCached(roomCode);
        if (cancelled) return;
        const st = String(bootstrap?.gameState || "")
          .trim()
          .toUpperCase();
        let target: string | null = null;
        if (st === "DRAFT" && bootstrap.gameModeStyle !== "league")
          target = `/room/${roomCode}/minigame/play`;
        else if (st === "GOLDEN") target = `/room/${roomCode}/minigame/golden`;
        else if (st === "POWERUPS")
          target = `/room/${roomCode}/minigame/powerups`;
        if (target) {
          activePhaseRedirectedRef.current = true;
          router.replace(target);
        }
      } catch {
        // Leave user on hub if bootstrap lookup fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, router, roomCode]);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const bootstrap = await getRoomBootstrapCached(roomCode);
        if (cancelled) return;
        const season = String(bootstrap?.seasonKey || "");
        const nextGw = Number(bootstrap?.currentGameweek ?? 1);
        setSeasonKey(season);
        setCurrentGw(Number.isFinite(nextGw) ? nextGw : 1);
        if (!season) return;
        setTableLoading(true);
        setTableError(null);
        try {
          const table = await getTableCached(season);
          if (cancelled) return;
          setTableRows(
            Array.isArray(table?.standingsTotal) ? table.standingsTotal : [],
          );
        } catch (e) {
          if (!cancelled) {
            setTableRows([]);
            setTableError(
              e instanceof Error ? e.message : "Failed to load table.",
            );
          }
        } finally {
          if (!cancelled) setTableLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSeasonKey("");
          setTableRows([]);
          setTableError("Failed to load table.");
          setTableLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, roomCode]);

  const predictionsRouteForState = (
    state: string,
    mode: typeof gameModeStyle = gameModeStyle,
  ) => {
    const st = String(state || "")
      .trim()
      .toUpperCase();
    if (st === "REVEAL") return `/room/${roomCode}/minigame/reveal`;
    if (mode === "league") return `/room/${roomCode}/minigame/play`;
    return `/room/${roomCode}/minigame`;
  };

  async function openPredictionsTarget() {
    const cachedBootstrap = peekRoomBootstrapCached(roomCode);
    const mode = cachedBootstrap?.gameModeStyle ?? gameModeStyle;
    const immediateHref = predictionsRouteForState(
      cachedBootstrap?.gameState || "",
      mode,
    );
    router.push(immediateHref);
    if (cachedBootstrap) return;
    void getRoomBootstrapCached(roomCode)
      .then((bootstrap) => {
        const nextHref = predictionsRouteForState(
          bootstrap?.gameState || "",
          bootstrap?.gameModeStyle ?? mode,
        );
        if (nextHref !== immediateHref) {
          router.replace(nextHref);
        }
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (roomRulesOpen) return;
      const target = event.target as Node | null;
      if (!target) return;
      const el = target as Element;
      if (
        typeof (el as Element).closest === "function" &&
        el.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (
        typeof el.closest === "function" &&
        el.closest("[data-settings-dropdown-root='true']")
      ) {
        return;
      }
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
  }, [settingsOpen]);

  useEffect(() => {
    return () => {
      if (settingsModalTimerRef.current != null) {
        window.clearTimeout(settingsModalTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => {
        if (!roomMeta) return;
        setLeaderUid(roomMeta.leaderUid);
        const style = roomMeta.settings.gameModeStyle;
        setGameModeStyle(style);
        setAllowIdenticalPicks(
          style === "sprint" ? true : !roomMeta.settings.sameResultLock,
        );
        setPowerupsEnabled(roomMeta.settings.powerupsEnabled === true);
        setLeagueFairPlayEnabled(
          roomMeta.settings.leagueFairPlayEnabled === true,
        );
        setThemeAccent(roomMeta.settings.themeAccent);
        setHasPassword(roomMeta.settings.hasPassword);
      },
      () => {},
    );
  }, [roomCode]);

  const isLeader = !!user && leaderUid === user.uid;
  const me = players.find((p) => p.uid === user?.uid) ?? null;
  const myDisplayName =
    me?.displayName || user?.email?.split("@")[0] || "Player";
  const myNickName = me?.nickName || "";

  useEffect(() => {
    setNickNameDraft(myNickName);
  }, [myNickName]);

  function openSettingsModalWithDelay(openModal: () => void, delayMs = 180) {
    setSettingsOpen(false);
    if (settingsModalTimerRef.current != null) {
      window.clearTimeout(settingsModalTimerRef.current);
    }
    settingsModalTimerRef.current = window.setTimeout(() => {
      settingsModalTimerRef.current = null;
      openModal();
    }, delayMs);
  }

  async function loadMemberRooms() {
    if (!user) return;
    setSwitcherBusy(true);
    setSwitcherError(null);
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
            const data = membershipSnap.data() as {
              role?: "leader" | "member";
            };
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
      setSwitcherError(
        e instanceof Error ? e.message : "Failed to switch room.",
      );
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
      const password = window.prompt(
        "Set room password (leave blank for none)",
      );
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
      setSwitcherError(
        e instanceof Error ? e.message : "Failed to create room.",
      );
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
      setSwitcherError(
        e instanceof Error ? e.message : "Failed to leave room.",
      );
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
      setPasswordError(
        e instanceof Error ? e.message : "Failed to save password.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  async function toggleSameResultLock() {
    if (!user || !isLeader || roomSettingsBusy || gameModeStyle === "sprint")
      return;
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

  async function toggleLeagueFairPlay() {
    if (!user || !isLeader || roomSettingsBusy || gameModeStyle !== "league")
      return;
    const nextEnabled = !leagueFairPlayEnabled;
    setRoomSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          leaderUid: user.uid,
          leagueFairPlayEnabled: nextEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data?.error || "Failed to update Fair Play.");
      setLeagueFairPlayEnabled(data?.leagueFairPlayEnabled === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update Fair Play.");
    } finally {
      setRoomSettingsBusy(false);
    }
  }

  async function recalcScoresFromHub() {
    if (!user || !isLeader || recalcBusy || !seasonKey) return;
    setRecalcBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw: currentGw,
          leaderUid: user.uid,
          seasonKey,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok)
        throw new Error(data.error || "Failed to recalculate scores.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to recalculate scores.",
      );
    } finally {
      setRecalcBusy(false);
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
    a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    }),
  );
  const resultLockSubtext =
    gameModeStyle === "league"
      ? `League • Fair Play ${leagueFairPlayEnabled ? "ON" : "OFF"}`
      : gameModeStyle === "sprint"
        ? "Sprint • Allow Identical Picks OFF"
        : gameModeStyle === "captain"
          ? `Captain • Allow Identical Picks ${allowIdenticalPicks ? "ON" : "OFF"}`
          : `Round-Robin • Allow Identical Picks ${allowIdenticalPicks ? "ON" : "OFF"}`;
  const standardSectionCardClass =
    "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5";
  const sharedButtonClass =
    "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-display font-semibold text-foreground transition hover:bg-white/[0.06] disabled:opacity-60";
  const sharedInputClass =
    "w-full rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-base text-foreground outline-none sm:text-sm";
  const modalSectionClass =
    "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5";
  const modalSectionTitleClass =
    "font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48";

  return (
    <>
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
        contentClassName="relative z-[1]"
      >
        <SectionStack gap="page">
          <TopActionRow
            title="Hub"
            subtitle={`${roomCode} • ${seasonLabel(seasonKey || "----")}`}
            className="flex items-start justify-between gap-3 sm:items-end"
            actions={
              <div ref={settingsWrapRef} className="relative z-[220] ml-auto">
                <SettingsTriggerButton
                  onClick={() => setSettingsOpen((v) => !v)}
                />
                <SettingsDropdownPanel
                  open={settingsOpen}
                  className="left-auto right-0 top-[calc(100%+0.5rem)] mt-0"
                >
                  <div className="font-display font-semibold text-foreground">
                    Settings
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-display text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-white/48">
                        Nickname
                      </div>
                      <button
                        type="button"
                        onClick={toggleNicknameSection}
                        className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.68rem] font-display font-semibold text-foreground transition hover:bg-white/[0.06]"
                      >
                        {nicknameExpanded ? "Collapse" : "Expand"}
                        {nicknameExpanded ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                    </div>
                    {nicknameExpanded && (
                      <div className="space-y-2 rounded-[20px] border border-white/8 bg-white/[0.025] p-3">
                        <input
                          value={nickNameDraft}
                          onChange={(e) => setNickNameDraft(e.target.value)}
                          maxLength={20}
                          placeholder="Nickname"
                          className={sharedInputClass}
                        />
                        <button
                          onClick={saveNickName}
                          disabled={nickNameBusy}
                          className={sharedButtonClass}
                        >
                          {nickNameBusy ? "Saving..." : "Save"}
                        </button>
                        <div className="text-xs text-muted">
                          Nickname shows across the room. Leave blank to use
                          your name.
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <SpecialBreak className="mt-2" />
                    <button
                      onClick={() => {
                        openSettingsModalWithDelay(() => {
                          setRoomSwitcherOpen(true);
                        });
                        void loadMemberRooms();
                      }}
                      className={sharedButtonClass}
                    >
                      Switch Rooms
                    </button>
                    <LogoutButton />
                    {isLeader && (
                      <div className="space-y-2">
                        <SpecialBreak />
                        <button
                          onClick={() => {
                            openSettingsModalWithDelay(() => {
                              setRoomRulesOpen(true);
                            });
                          }}
                          className={sharedButtonClass}
                        >
                          Room Settings
                        </button>
                      </div>
                    )}
                    <div className="pt-1 text-center text-[0.68rem] font-semibold tracking-[0.14em] text-white/32">
                      v2.1.0
                    </div>
                  </div>
                </SettingsDropdownPanel>
              </div>
            }
          />

          {error && (
            <SectionCard className={standardSectionCardClass}>
              <div className="text-sm text-rose-300">{error}</div>
            </SectionCard>
          )}

          <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-1">
            <div className="rounded-[24px] border border-white/6 bg-[radial-gradient(circle_at_top_right,rgba(var(--room-accent-rgb),0.1),transparent_38%),linear-gradient(180deg,rgba(5,10,22,0.92),rgba(7,10,18,0.88))] px-4 py-4 sm:px-5 sm:py-5">
              <SectionStack gap="tight">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/42">
                      Room desk
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/72">
                        Active room
                      </span>
                      <span className="font-display text-[1.5rem] font-semibold text-foreground sm:text-[1.75rem]">
                        {roomCode}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
                  <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-white/42">
                    Control centre
                  </span>
                  <span className="font-display text-sm font-semibold text-foreground">
                    Welcome, Lets GO!
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="text-[0.62rem] uppercase tracking-[0.16em] text-white/38">
                      Players
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">
                      {players.length}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Registered in this room right now.
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="text-[0.62rem] uppercase tracking-[0.16em] text-white/38">
                      Mode
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">
                      {gameModeStyle === "round_robin"
                        ? "Round-Robin"
                        : gameModeStyle === "captain"
                          ? "Captain"
                          : gameModeStyle === "league"
                            ? "League"
                            : "Sprint"}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {resultLockSubtext}
                    </div>
                  </div>
                </div>
              </SectionStack>
            </div>
          </SectionCard>

          <div className="hidden lg:block">
            <SectionCard className={standardSectionCardClass}>
              <SectionStack gap="tight">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                      Quick routes
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">
                      Core room navigation
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] text-white/62">
                    Desktop rail
                  </div>
                </div>
                <SectionGrid gap="tight" className="xl:grid-cols-4">
                  <HubNavTile
                    label="Fixtures"
                    hint="Games, scores, and room picks"
                    icon={CalendarDays}
                    onClick={() => router.push(`/room/${roomCode}/fixtures`)}
                  />
                  <HubNavTile
                    label="Predictions"
                    hint="Current mini-game flow"
                    icon={Gamepad2}
                    onClick={() => {
                      void openPredictionsTarget();
                    }}
                  />
                  <HubNavTile
                    label="Leaderboard"
                    hint="Room ranking and gameweek matrix"
                    icon={Trophy}
                    onClick={() => router.push(`/room/${roomCode}/leaderboard`)}
                  />
                  <HubNavTile
                    label="Stats"
                    hint="Player profile and scoring trends"
                    icon={BarChart3}
                    onClick={() => router.push(`/room/${roomCode}/stats`)}
                  />
                </SectionGrid>
              </SectionStack>
            </SectionCard>
          </div>

          <SectionCard className={standardSectionCardClass}>
            <SectionStack gap="tight">
              <div>
                <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                  Your seat
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-foreground">
                  Room identity
                </div>
              </div>
              <SectionGrid gap="tight" className="sm:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/46">
                    Display
                  </div>
                  <div className="mt-2 font-display text-lg font-semibold text-foreground">
                    {myNickName
                      ? `${myNickName} • ${myDisplayName}`
                      : myDisplayName}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/46">
                    Role
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusPill
                      label={isLeader ? "Leader" : "Member"}
                      tone="neutral"
                    />
                    {user?.uid ? (
                      <StatusPill
                        label="You"
                        tone="you"
                        className="text-[10px] py-0.5"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/46">
                    Security
                  </div>
                  <div className="mt-2 font-display text-sm font-semibold text-foreground">
                    {hasPassword ? "Private room" : "Open room"}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {hasPassword
                      ? "Password is enabled for new joins."
                      : "Members can join without a password."}
                  </div>
                </div>
              </SectionGrid>
            </SectionStack>
          </SectionCard>

          <SectionGrid gap="page" className="xl:grid-cols-2 xl:items-start">
            <SectionCard className={standardSectionCardClass}>
              <SectionStack gap="tight">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                      Premier League table
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">
                      Live standings
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {seasonKey ? seasonLabel(seasonKey) : "Current season"}
                    </div>
                  </div>
                  {tableLoading ? (
                    <span className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-muted">
                      <Loader2 size={12} className="animate-spin" />
                      <span>Loading…</span>
                    </span>
                  ) : null}
                </div>
                {tableError ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-rose-300">
                    {tableError}
                  </div>
                ) : !tableLoading && tableRows.length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-muted">
                    No table rows available yet.
                  </div>
                ) : (
                  <div className="max-h-[460px] overflow-auto no-scrollbar rounded-[22px] border border-white/8 bg-white/[0.02]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-black/10 text-muted">
                        <tr className="border-b border-white/8">
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Club</th>
                          <th className="px-3 py-2 text-center">P</th>
                          <th className="px-3 py-2 text-center">GD</th>
                          <th className="px-3 py-2 text-center">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((row) => (
                          <tr
                            key={`${row.position}-${row.team.name}`}
                            className="border-b border-white/8 last:border-0"
                          >
                            <td className="px-3 py-2 font-display text-foreground">
                              {row.position}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-white/[0.03]">
                                  {row.team.badge ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={row.team.badge}
                                      alt={row.team.name}
                                      className="h-5 w-5 object-contain"
                                    />
                                  ) : null}
                                </div>
                                <span className="font-display text-foreground">
                                  {row.team.tla ||
                                    row.team.shortName ||
                                    row.team.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center text-foreground">
                              {row.playedGames}
                            </td>
                            <td className="px-3 py-2 text-center text-foreground">
                              {row.goalDifference}
                            </td>
                            <td className="px-3 py-2 text-center font-display font-semibold text-foreground">
                              {row.points}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionStack>
            </SectionCard>

            <SectionCard className={standardSectionCardClass}>
              <SectionStack gap="tight">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                      Squad
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold text-foreground">
                      Room players
                    </div>
                  </div>
                  {isLeader && (
                    <button
                      onClick={() => setShowKickControls((v) => !v)}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.68rem] font-display font-semibold uppercase tracking-[0.12em] text-foreground transition hover:bg-white/[0.06]"
                    >
                      {showKickControls ? "Hide Kick" : "Show Kick"}
                    </button>
                  )}
                </div>
                <SectionStack gap="tight">
                  {sortedPlayers.map((p) => (
                    <div
                      key={p.uid}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-sm font-semibold text-foreground">
                          <span className="block truncate">
                            {p.nickName
                              ? `(${p.nickName}) ${p.displayName}`
                              : p.displayName}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {p.uid === user?.uid ? (
                            <StatusPill
                              label="You"
                              tone="you"
                              className="shrink-0 text-[10px] py-0.5"
                            />
                          ) : null}
                          {p.role === "leader" ? (
                            <StatusPill label="Leader" tone="neutral" />
                          ) : null}
                        </div>
                      </div>
                      <div className="ml-2 flex h-8 items-center justify-end">
                        {isLeader && showKickControls && p.uid !== user?.uid ? (
                          <StatusPill
                            label="Kick"
                            tone="danger"
                            onClick={() => setKickTarget(p)}
                          />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </SectionStack>
              </SectionStack>
            </SectionCard>
          </SectionGrid>
        </SectionStack>
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
            from room{" "}
            <span className="font-display text-foreground">{roomCode}</span>?
          </>
        }
        confirmLabel="Confirm Remove"
        confirming={kickBusy}
        danger
      />
      <ThemedSheetModal
        open={roomSwitcherOpen}
        onClose={() => setRoomSwitcherOpen(false)}
        maxWidthClassName="max-w-4xl"
      >
        <ModalHeader
          title="Switch Rooms"
          onClose={() => setRoomSwitcherOpen(false)}
          showCloseButton
          closeButtonClassName="hidden sm:inline-flex"
        />

        {switcherError && (
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-rose-300">
            {switcherError}
          </div>
        )}

        <div className={modalSectionClass}>
          <div className={modalSectionTitleClass}>Your Rooms</div>
          <div className="mt-1 text-sm text-muted">
            Move between rooms you already belong to without leaving the hub.
          </div>
          <div className="mt-4 space-y-2">
            {switcherBusy ? (
              <div className="text-sm text-muted inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading rooms…</span>
              </div>
            ) : memberRooms.length === 0 ? (
              <div className="text-sm text-muted">No joined rooms found.</div>
            ) : (
              memberRooms.map((r) => (
                <button
                  key={r.roomCode}
                  disabled={switcherBusy || r.roomCode === roomCode}
                  onClick={() => switchToRoom(r.roomCode)}
                  className={`${sharedButtonClass} text-left`}
                >
                  <span className="font-display">{r.roomCode}</span>{" "}
                  {r.roomCode === roomCode ? "• Current" : ""}
                </button>
              ))
            )}
          </div>
        </div>
        <SectionGrid gap="page" className="lg:grid-cols-2">
          <div className={modalSectionClass}>
            <div className={modalSectionTitleClass}>Join New Room</div>
            <div className="mt-1 text-sm text-muted">
              Enter a room code to join another active room.
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="AB12"
                className={`${sharedInputClass} min-w-0 uppercase font-display tracking-[0.08em]`}
                inputMode="text"
              />
              <button
                onClick={joinNewRoom}
                disabled={switcherBusy}
                className={sharedButtonClass}
              >
                Join
              </button>
            </div>
          </div>

          <div className={modalSectionClass}>
            <div className={modalSectionTitleClass}>Create New Room</div>
            <div className="mt-1 text-sm text-muted">
              Create a fresh room using a new code.
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <input
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                placeholder="NEW25"
                className={`${sharedInputClass} min-w-0 uppercase font-display tracking-[0.08em]`}
                inputMode="text"
              />
              <button
                onClick={createNewRoom}
                disabled={switcherBusy}
                className={sharedButtonClass}
              >
                Create
              </button>
            </div>
          </div>
        </SectionGrid>

        <div
          className={`${modalSectionClass} border-rose-400/30 bg-rose-500/[0.06]`}
        >
          <div className={modalSectionTitleClass}>Current Room</div>
          <div className="mt-1 text-sm text-muted">
            Leave{" "}
            <span className="font-display text-foreground">{roomCode}</span> and
            return to room selection.
          </div>
          <button
            onClick={leaveCurrentRoom}
            disabled={switcherBusy}
            className={`${sharedButtonClass} mt-4 text-danger`}
          >
            Leave Current Room
          </button>
        </div>
      </ThemedSheetModal>
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
            Delete room{" "}
            <span className="font-display text-foreground">{roomCode}</span> for
            everyone? This cannot be undone.
          </>
        }
        confirmLabel="Confirm Delete"
        confirming={deleteBusy}
        danger
      />
      <ThemedSheetModal
        open={roomRulesOpen}
        onClose={() => setRoomRulesOpen(false)}
        maxWidthClassName="max-w-4xl"
      >
        <ModalHeader
          title="Room Settings"
          onClose={() => setRoomRulesOpen(false)}
          showCloseButton
          closeButtonClassName="hidden sm:inline-flex"
        />
        <SectionGrid
          gap="page"
          className="lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
        >
          <SectionStack gap="page">
            <div className={modalSectionClass}>
              <div className={modalSectionTitleClass}>Access</div>
              <div className="mt-1 text-sm text-muted">
                Control room privacy and password protection for new joins.
              </div>
              <button
                onClick={openPasswordModal}
                disabled={roomSettingsBusy}
                className={`${sharedButtonClass} mt-4`}
              >
                {hasPassword ? "Change Password" : "Set Password"}
              </button>
              <button
                onClick={recalcScoresFromHub}
                disabled={recalcBusy || !seasonKey}
                className={`${sharedButtonClass} mt-2`}
              >
                {recalcBusy
                  ? `Recalculating GW${currentGw}...`
                  : "Recalculate Scores"}
              </button>
            </div>

            <div className={modalSectionClass}>
              <div className={modalSectionTitleClass}>Theme Accent</div>
              <div className="mt-1 text-sm text-muted">
                Apply a room-wide visual accent across shared surfaces.
              </div>
              <div className="relative mt-4">
                <select
                  value={themeAccent}
                  onChange={(e) => updateThemeAccent(e.target.value)}
                  disabled={roomSettingsBusy}
                  className="h-11 w-full appearance-none rounded-2xl border border-white/8 bg-white/[0.035] px-8 text-center font-display text-base font-semibold text-foreground outline-none [text-align-last:center] disabled:opacity-60 sm:text-sm"
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
          </SectionStack>

          <SectionStack gap="page">
            {gameModeStyle === "league" ? (
              <div
                className={`${modalSectionClass} border-emerald-300/20 bg-emerald-400/[0.04]`}
              >
                <div className={modalSectionTitleClass}>League Fair Play</div>
                <div className="mt-1 text-sm text-muted">
                  If a player misses the whole gameweek, award the room median
                  as a labelled Fair Play bye.
                </div>
                <button
                  onClick={toggleLeagueFairPlay}
                  disabled={roomSettingsBusy}
                  className={`${sharedButtonClass} mt-4`}
                >
                  {roomSettingsBusy
                    ? "Saving..."
                    : leagueFairPlayEnabled
                      ? "Fair Play: ON"
                      : "Fair Play: OFF"}
                </button>
              </div>
            ) : null}
            <div
              className={`${modalSectionClass} border-rose-400/30 bg-rose-500/[0.06]`}
            >
              <div className={modalSectionTitleClass}>Danger Zone</div>
              <div className="mt-1 text-sm text-muted">
                Delete this room and remove it for every player.
              </div>
              <button
                onClick={deleteRoomAsLeader}
                disabled={deleteBusy}
                className={`${sharedButtonClass} mt-4 text-danger`}
              >
                {deleteBusy ? "Deleting room…" : "Delete Room"}
              </button>
            </div>
          </SectionStack>
        </SectionGrid>
      </ThemedSheetModal>
      <ThemedModal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        maxWidthClassName="max-w-lg"
      >
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
              className={sharedInputClass}
            />
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs text-muted">New Password</label>
          <input
            type="password"
            value={newPasswordDraft}
            onChange={(e) => setNewPasswordDraft(e.target.value)}
            className={sharedInputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Confirm Password</label>
          <input
            type="password"
            value={confirmPasswordDraft}
            onChange={(e) => setConfirmPasswordDraft(e.target.value)}
            className={sharedInputClass}
          />
        </div>
        {passwordError && (
          <div className="text-sm text-danger">{passwordError}</div>
        )}
        <button
          onClick={saveRoomPassword}
          disabled={passwordBusy}
          className={sharedButtonClass}
        >
          {passwordBusy
            ? "Saving..."
            : hasPassword
              ? "Change Password"
              : "Set Password"}
        </button>
      </ThemedModal>
    </>
  );
}
