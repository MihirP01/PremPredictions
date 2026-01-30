// Minigame Lobby page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import { auth, db } from "../../../../firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { signOut } from "firebase/auth";

export default function MiniGameLobbyPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode]
  );

  const { user, loading } = useAuth();
  const router = useRouter();

  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [gameweek, setGameweek] = useState<number | null>(null);

  const [myDisplayName, setMyDisplayName] = useState<string>("Player");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isLeader = !!user && leaderUid === user.uid;

  // Track current lobby doc ref so we can reliably remove it on back/logout/unmount
  const lobbyRefRef = useRef<ReturnType<typeof doc> | null>(null);

  // 1) Auth guard + load room leader
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    (async () => {
      const roomSnap = await getDoc(doc(db, "rooms", roomCode));
      if (!roomSnap.exists()) {
        router.replace("/room-gate");
        return;
      }
      if (!cancelled) setLeaderUid(roomSnap.data()?.leaderUid ?? null);
    })().catch(() => setError("Failed to load room."));

    return () => {
      cancelled = true;
    };
  }, [loading, user, router, roomCode]);

  // 2) Load current gameweek (lobby is tied to GW)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch("/api/current-gameweek");
      if (!res.ok) throw new Error("bad");
      const data = await res.json();
      const gw = Number(data?.currentGameweek ?? 1);
      if (!cancelled) setGameweek(Number.isFinite(gw) ? gw : 1);
    })().catch(() => {
      if (!cancelled) setGameweek(1);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 3) Resolve best display name (don’t rely on auth.user.displayName)
  // Priority:
  //   a) rooms/{roomCode}/players/{uid}.displayName
  //   b) users/{uid}.displayName
  //   c) email prefix
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      const emailFallback = user.email?.split("@")[0] || "Player";

      try {
        const roomPlayerSnap = await getDoc(
          doc(db, "rooms", roomCode, "players", user.uid)
        );
        if (roomPlayerSnap.exists()) {
          const dn = (roomPlayerSnap.data() as any)?.displayName;
          if (!cancelled && dn) {
            setMyDisplayName(dn);
            return;
          }
        }
      } catch {}

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          const dn = (userSnap.data() as any)?.displayName;
          if (!cancelled && dn) {
            setMyDisplayName(dn);
            return;
          }
        }
      } catch {}

      if (!cancelled) setMyDisplayName(emailFallback);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, roomCode]);

  // 4) Presence: join lobby on enter, heartbeat, leave on exit
  useEffect(() => {
    if (!user || gameweek == null) return;

    const gwId = `gw-${gameweek}`;
    const lobbyRef = doc(db, "rooms", roomCode, "games", gwId, "lobby", user.uid);
    lobbyRefRef.current = lobbyRef;

    let stopped = false;

    const upsertPresence = async () => {
      if (stopped) return;
      await setDoc(
        lobbyRef,
        {
          uid: user.uid,
          displayName: myDisplayName,
          joinedAt: serverTimestamp(), // merge keeps existing if set earlier
          lastSeenAt: serverTimestamp(),
        },
        { merge: true }
      );
    };

    // initial join
    upsertPresence().catch(() => {});

    // heartbeat
    const t = setInterval(() => {
      upsertPresence().catch(() => {});
    }, 15000);

    return () => {
      stopped = true;
      clearInterval(t);
      deleteDoc(lobbyRef).catch(() => {});
    };
  }, [user, roomCode, gameweek, myDisplayName]);

  // 5) Listen to lobby players (ONLY minigame lobby, not room members)
  useEffect(() => {
    if (!user || gameweek == null) return;

    const gwId = `gw-${gameweek}`;
    const q = query(collection(db, "rooms", roomCode, "games", gwId, "lobby"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: LobbyPlayer[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: d.id,
            displayName: data?.displayName || "Player",
          };
        });

        // Sort stable so UI doesn’t jump
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPlayers(list);
      },
      () => setError("Failed to listen for lobby players.")
    );

    return () => unsub();
  }, [user, roomCode, gameweek]);

  // 6) Auto-redirect everyone when the leader starts the game
 const redirectedRef = useRef(false);

const routedRef = useRef(false);

useEffect(() => {
  if (!user) return;
  if (!roomCode) return;
  if (gameweek == null) return;

  const gameRef = doc(db, "rooms", roomCode.toUpperCase(), "games", `gw-${gameweek}`);

  const unsub = onSnapshot(
    gameRef,
    (snap) => {
      const raw = (snap.data() as any)?.state;
      const st = String(raw ?? "").trim().toUpperCase();

      // DEBUG (keep for now)
      console.log("[minigame lobby] state:", raw, "=>", st);

      if (routedRef.current) return;

      if (st === "DRAFT") {
        routedRef.current = true;
        router.replace(`/room/${roomCode}/minigame/play`);
        return;
      }

      if (st === "GOLDEN") {
        routedRef.current = true;
        router.replace(`/room/${roomCode}/minigame/golden`);
        return;
      }

      if (st === "REVEAL") {
        routedRef.current = true;
        router.replace(`/room/${roomCode}/minigame/reveal`);
        return;
      }
    },
    (err) => {
      console.log("[minigame lobby] snapshot error:", err?.message || err);
    }
  );

  return () => unsub();
}, [user, roomCode, gameweek, router]);
type LobbyPlayer = { uid: string; displayName: string };

  async function safeLeaveLobby() {
    const ref = lobbyRefRef.current;
    if (ref) {
      await deleteDoc(ref).catch(() => {});
      lobbyRefRef.current = null;
    }
  }

  async function onBack() {
    await safeLeaveLobby();
    router.push(`/room/${roomCode}`);
  }

  async function onLogout() {
    setLoggingOut(true);
    setError(null);
    try {
      await safeLeaveLobby();
      await signOut(auth);
      router.replace("/login");
    } catch {
      setError("Failed to log out.");
    } finally {
      setLoggingOut(false);
    }
  }

  async function startMiniGame() {
    if (!user) return;
    if (gameweek == null) {
      setError("Gameweek not loaded yet.");
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw: gameweek,
          leaderUid: user.uid,
        }), 
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to start mini-game.");

      // Leader goes immediately; others will follow via the gameRef listener
      router.push(`/room/${roomCode}/minigame/play`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start mini-game.");
    } finally {
      setStarting(false);
    }
  }

  // Simple loading guard
  if (loading) return null;

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Mini-game Lobby</h1>
            <div className="text-sm text-gray-500">
              Room {roomCode} {gameweek != null ? `• GW ${gameweek}` : ""}
            </div>
            <div className="text-sm text-gray-500">You are: {myDisplayName}</div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onBack}
              className="text-sm border rounded-lg px-4 py-2"
            >
              Back
            </button>

            <button
              onClick={onLogout}
              disabled={loggingOut}
              className="text-sm border rounded-lg px-4 py-2 disabled:opacity-60"
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="border rounded-xl p-4">
          <div className="font-semibold mb-2">Players in Mini-game Lobby</div>
          <div className="space-y-2">
            {players.length === 0 ? (
              <div className="text-sm text-gray-500">No one is in the lobby yet.</div>
            ) : (
              players.map((p) => (
                <div
                  key={p.uid}
                  className="flex items-center justify-between border-b last:border-0 py-2"
                >
                  <div className="font-medium">{p.displayName}</div>
                  {p.uid === leaderUid && (
                    <span className="text-xs bg-gray-100 rounded-full px-2 py-1">
                      Leader
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border rounded-xl p-4 space-y-2">
          <div className="font-semibold">Mini-game Controls</div>

          {isLeader ? (
            <>
              <div className="text-sm text-gray-600">
                When everyone is in this lobby, start the round-robin.
              </div>

              <button
                className="bg-black text-white rounded-lg px-4 py-2 disabled:opacity-60"
                disabled={starting || gameweek == null || players.length < 2}
                onClick={startMiniGame}
              >
                {starting ? "Starting…" : "Start Mini-game"}
              </button>

              {players.length < 2 && (
                <div className="text-xs text-gray-500">
                  Need at least 2 players in the lobby to start.
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-600">
              Waiting for the leader to start…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}