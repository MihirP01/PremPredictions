"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebase";

type AuthCtx = { user: User | null; loading: boolean };

const Ctx = createContext<AuthCtx>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};

    auth
      .authStateReady()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setUser(auth.currentUser);
        setLoading(false);
        unsub = onAuthStateChanged(auth, (next) => {
          if (cancelled) return;
          setUser(next);
          setLoading(false);
        });
      });

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
