"use client";

import LogoutButton from "../../../components/LogoutButton"; // adjust relative path
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";
import { db } from "../../../firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

type Player = { uid: string; displayName: string; role: "leader" | "member" };

export default function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode]
  );

  const { user, loading } = useAuth();
  const router = useRouter();

  const [leaderUid, setLeaderUid] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Leader tool state
  const [gw, setGw] = useState<number | null>(null);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

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

      // ensure user is a member (if they hit URL directly)
      const memberSnap = await getDoc(doc(db, "rooms", roomCode, "players", user.uid));
      if (!memberSnap.exists()) {
        await setDoc(doc(db, "rooms", roomCode, "players", user.uid), {
          displayName: user.email?.split("@")[0] || "Player",
          role: "member",
          joinedAt: serverTimestamp(),
        });
      }

      // players listener
      const q = query(collection(db, "rooms", roomCode, "players"));
      unsubPlayers = onSnapshot(q, (snap) => {
        const list: Player[] = snap.docs.map((d) => {
          const data = d.data() as any;
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

  // Load current GW for leader tools
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/current-gameweek", { cache: "no-store" });
        const data = await res.json();
        const n = Number(data?.currentGameweek ?? 1);
        if (!cancelled) setGw(Number.isFinite(n) ? n : 1);
      } catch {
        if (!cancelled) setGw(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isLeader = !!user && leaderUid === user.uid;

  const kick = async (targetUid: string) => {
    if (!isLeader) return;
    setError(null);

    try {
      await deleteDoc(doc(db, "rooms", roomCode, "players", targetUid));
    } catch {
      setError("Kick failed (check Firestore rules).");
    }
  };

  async function recalcScores() {
    if (!user || !isLeader) return;
    if (gw == null) return;

    setRecalcLoading(true);
    setRecalcMsg(null);
    setError(null);

    try {
      const res = await fetch("/api/game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, gw, leaderUid: user.uid }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to recalculate scores.");

      setRecalcMsg(`✅ Scores updated for GW${gw} (scored ${data?.scored ?? "?"} users)`);
    } catch (e: any) {
      setRecalcMsg(null);
      setError(e?.message ?? "Failed to recalculate scores.");
    } finally {
      setRecalcLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Room {roomCode}</h1>
          <div className="flex gap-2">
            <LogoutButton />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => router.push(`/room/${roomCode}/fixtures`)}
            className="text-sm bg-black text-white rounded-lg px-4 py-2"
          >
            Fixtures
          </button>

          <button
            onClick={() => router.push(`/room/${roomCode}/minigame`)}
            className="text-sm bg-black text-white rounded-lg px-4 py-2"
          >
            Predict Next Week
          </button>

          <button
            onClick={() => router.push(`/room/${roomCode}/leaderboard`)}
            className="text-sm bg-black text-white rounded-lg px-4 py-2"
          >
            Leaderboard
          </button>
        </div>

        {/* Leader tools */}
        {isLeader && (
          <div className="border rounded-xl p-4 space-y-2">
            <div className="font-semibold">Leader tools</div>
            <div className="text-sm text-gray-600">
              Manually pull latest finished results and recompute scores for the current GW.
            </div>

            <button
              onClick={recalcScores}
              disabled={recalcLoading || gw == null}
              className="text-sm bg-black text-white rounded-lg px-4 py-2 disabled:opacity-60"
            >
              {recalcLoading ? "Updating…" : `Update Results / Recalculate (GW${gw ?? "?"})`}
            </button>

            {recalcMsg && <div className="text-sm text-green-700">{recalcMsg}</div>}
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="border rounded-xl p-4">
          <div className="font-semibold mb-2">Players</div>
          <div className="space-y-2">
            {players.map((p) => (
              <div
                key={p.uid}
                className="flex items-center justify-between border-b last:border-0 py-2"
              >
                <div>
                  <div className="font-medium">{p.displayName}</div>
                  <div className="text-xs text-gray-500">{p.role}</div>
                </div>

                {isLeader && user?.uid !== p.uid && (
                  <button
                    onClick={() => kick(p.uid)}
                    className="text-sm border rounded-lg px-3 py-1"
                  >
                    Kick
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="text-sm text-gray-500">
          Next: scoring is now persisted in Firestore via /api/game/score.
        </div>
      </div>
    </div>
  );
}