"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        const uid = cred.user.uid;

        await setDoc(
          doc(db, "users", uid),
          {
            displayName: displayName || email.split("@")[0],
            currentRoomCode: null,
            createdAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      router.replace("/room-gate");
    } catch (e: any) {
      setError(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-app">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-card p-6 space-y-4 border border-subtle">
        <h1 className="text-2xl font-semibold text-foreground">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>

        {mode === "signup" && (
          <div>
            <label className="text-sm text-muted">Display name</label>
            <input
              className="w-full rounded-lg p-2 bg-surface border border-subtle text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              value={displayName}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Mihir"
              autoComplete="nickname"
            />
          </div>
        )}

        <div>
          <label className="text-sm text-muted">Email</label>
          <input
            type="email"
            className="w-full rounded-lg p-2 bg-surface border border-subtle text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@email.com"
            autoComplete={mode === "signin" ? "email" : "email"}
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>

        <div>
          <label className="text-sm text-muted">Password</label>
          <input
            type="password"
            className="w-full rounded-lg p-2 bg-surface border border-subtle text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
          />
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full rounded-lg px-4 py-2 bg-accent text-accent-foreground disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>

        <button
          onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
          disabled={busy}
          className="w-full text-sm text-muted underline disabled:opacity-60"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
