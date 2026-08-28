"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebase";
import { setPersistentRoomCacheOwner } from "@/lib/sessionCache";

type AuthCtx = { user: User | null; loading: boolean };

const Ctx = createContext<AuthCtx>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, (next) => {
      if (cancelled) return;
      setPersistentRoomCacheOwner(next?.uid ?? null);
      setUser(next);
      setLoading(false);
    });
    void auth.authStateReady().catch(() => undefined);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return <Ctx.Provider value={{ user, loading }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
