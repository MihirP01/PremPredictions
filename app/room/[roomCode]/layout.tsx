"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../components/AuthProvider";

type AccentTheme = {
  hex: string;
  rgb: string;
  bgLight: string;
  bgDark: string;
  solidLight: string;
  solidDark: string;
};

const ACCENT_THEME: Record<string, AccentTheme> = {
  teal: {
    hex: "#2dd4bf",
    rgb: "45,212,191",
    bgLight: "linear-gradient(135deg, #d9f2f0, #a7e1dc, #6fc3bf)",
    bgDark: "linear-gradient(135deg, #06181c, #0b3b3a, #0ea5a4)",
    solidLight: "#d9f2f0",
    solidDark: "#06181c",
  },
  blue: {
    hex: "#60a5fa",
    rgb: "96,165,250",
    bgLight: "linear-gradient(135deg, #e2ecff, #c6daff, #98bfff)",
    bgDark: "linear-gradient(135deg, #081325, #132b4d, #2563eb)",
    solidLight: "#e2ecff",
    solidDark: "#081325",
  },
  emerald: {
    hex: "#34d399",
    rgb: "52,211,153",
    bgLight: "linear-gradient(135deg, #dff8ee, #baf0dd, #86e0be)",
    bgDark: "linear-gradient(135deg, #071c16, #124737, #059669)",
    solidLight: "#dff8ee",
    solidDark: "#071c16",
  },
  orange: {
    hex: "#fb923c",
    rgb: "251,146,60",
    bgLight: "linear-gradient(135deg, #fff0e2, #ffd7b3, #ffb57a)",
    bgDark: "linear-gradient(135deg, #241306, #4f2a0f, #c2410c)",
    solidLight: "#fff0e2",
    solidDark: "#241306",
  },
  rose: {
    hex: "#fb7185",
    rgb: "251,113,133",
    bgLight: "linear-gradient(135deg, #ffe6ec, #ffc9d5, #ff9eb3)",
    bgDark: "linear-gradient(135deg, #260a13, #532136, #be185d)",
    solidLight: "#ffe6ec",
    solidDark: "#260a13",
  },
  red: {
    hex: "#ef4444",
    rgb: "239,68,68",
    bgLight: "linear-gradient(135deg, #ffe7e7, #ffc8c8, #ff9e9e)",
    bgDark: "linear-gradient(135deg, #2a0c0c, #5a1717, #b91c1c)",
    solidLight: "#ffe7e7",
    solidDark: "#2a0c0c",
  },
  slate: {
    hex: "#94a3b8",
    rgb: "148,163,184",
    bgLight: "linear-gradient(135deg, #edf1f6, #d8e0eb, #becadb)",
    bgDark: "linear-gradient(135deg, #0f172a, #1e293b, #334155)",
    solidLight: "#edf1f6",
    solidDark: "#0f172a",
  },
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
  const router = useRouter();
  const { user, loading } = useAuth();
  const roomCode = useMemo(
    () => String(params.roomCode || "").toUpperCase(),
    [params.roomCode],
  );
  const [accentKey, setAccentKey] = useState<string>("teal");
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading || !user || !roomCode) return;
    const membershipRef = doc(db, "rooms", roomCode, "players", user.uid);
    const forceToRoomGate = () => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      setDoc(
        doc(db, "users", user.uid),
        { currentRoomCode: null },
        { merge: true },
      ).catch(() => {});
      router.replace("/room-gate?kicked=1");
    };
    const unsub = onSnapshot(
      membershipRef,
      (snap) => {
        if (snap.exists()) {
          redirectedRef.current = false;
          return;
        }
        forceToRoomGate();
      },
      () => {
        // When kicked, rules can deny read before `exists=false` is delivered.
        forceToRoomGate();
      },
    );
    return () => unsub();
  }, [loading, user, roomCode, router]);

  useEffect(() => {
    if (!roomCode) return;
    const ref = doc(db, "rooms", roomCode);
    const unsub = onSnapshot(ref, (snap) => {
      const room = snap.data() as RoomDoc | undefined;
      const key = String(room?.settings?.themeAccent || "teal").toLowerCase();
      setAccentKey(ACCENT_THEME[key] ? key : "teal");
    });
    return () => unsub();
  }, [roomCode]);

  const accent = ACCENT_THEME[accentKey] || ACCENT_THEME.teal;

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const prevBg = root.style.getPropertyValue("--app-bg");
    const prevSolid = root.style.getPropertyValue("--app-solid");

    const applyBg = () => {
      root.style.setProperty("--app-bg", prefersDark.matches ? accent.bgDark : accent.bgLight);
      root.style.setProperty("--app-solid", prefersDark.matches ? accent.solidDark : accent.solidLight);
    };
    applyBg();
    prefersDark.addEventListener("change", applyBg);

    return () => {
      prefersDark.removeEventListener("change", applyBg);
      if (prevBg) root.style.setProperty("--app-bg", prevBg);
      else root.style.removeProperty("--app-bg");
      if (prevSolid) root.style.setProperty("--app-solid", prevSolid);
      else root.style.removeProperty("--app-solid");
    };
  }, [accent.bgDark, accent.bgLight, accent.solidDark, accent.solidLight]);

  return (
    <div
      className="room-theme"
      style={
        {
          "--room-accent": accent.hex,
          "--room-accent-rgb": accent.rgb,
          "--accent": accent.hex,
          "--shadow-card": `0 10px 30px rgba(${accent.rgb}, 0.20)`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
