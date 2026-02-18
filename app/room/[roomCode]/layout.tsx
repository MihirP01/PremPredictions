"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";

const ACCENT_HEX: Record<string, string> = {
  teal: "#2dd4bf",
  blue: "#60a5fa",
  emerald: "#34d399",
  orange: "#fb923c",
  rose: "#fb7185",
  slate: "#94a3b8",
};

type RoomDoc = {
  settings?: {
    themeAccent?: string;
  };
};

export default function RoomScopedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode || "").toUpperCase(),
    [params.roomCode],
  );
  const [accentKey, setAccentKey] = useState<string>("teal");

  useEffect(() => {
    if (!roomCode) return;
    const ref = doc(db, "rooms", roomCode);
    const unsub = onSnapshot(ref, (snap) => {
      const room = snap.data() as RoomDoc | undefined;
      const key = String(room?.settings?.themeAccent || "teal").toLowerCase();
      setAccentKey(ACCENT_HEX[key] ? key : "teal");
    });
    return () => unsub();
  }, [roomCode]);

  const accent = ACCENT_HEX[accentKey] || ACCENT_HEX.teal;

  return (
    <div
      className="room-theme"
      style={{ "--room-accent": accent, "--accent": accent } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
