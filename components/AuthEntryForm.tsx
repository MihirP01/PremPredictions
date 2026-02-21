"use client";

import React, { useEffect, useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import AnimatedModal from "./AnimatedModal";

type InstallPlatform = "ios" | "android" | "other";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function AuthEntryForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform>("other");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const evaluateDevice = () => {
      if (typeof window === "undefined") return;
      const ua = window.navigator.userAgent || "";
      const platform = window.navigator.platform || "";
      const touchPoints = (window.navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;

      const iosPhone = /iPhone|iPod/i.test(ua);
      const androidPhone = /Android/i.test(ua);
      const standalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
      const smallScreen = window.matchMedia?.("(max-width: 900px)")?.matches ?? false;
      const mobileLike = iosPhone || androidPhone || (/Mac/i.test(platform) && touchPoints > 1);

      setIsPhone(!standalone && smallScreen && mobileLike);
      if (iosPhone) setInstallPlatform("ios");
      else if (androidPhone) setInstallPlatform("android");
      else setInstallPlatform("other");
    };

    evaluateDevice();
    window.addEventListener("resize", evaluateDevice);
    return () => window.removeEventListener("resize", evaluateDevice);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
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

      window.location.replace("/room-gate");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const runAndroidInstallPrompt = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
      setShowInstallHelp(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-app">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-subtle">
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
              placeholder="Player Name"
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
            autoComplete="email"
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
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>

        {isPhone ? (
          <button
            type="button"
            onClick={() => setShowInstallHelp(true)}
            className="w-full rounded-lg border border-teal-500 px-4 py-2 font-semibold text-foreground hover:bg-surface-2"
          >
            ADD TO HOME SCREEN
          </button>
        ) : null}
      </div>

      <AnimatedModal
        open={showInstallHelp}
        onClose={() => setShowInstallHelp(false)}
        portal
        lockBackground
        closeOnBackdrop={false}
        zIndexClassName="z-50"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-sm rounded-2xl border border-teal-500 bg-surface p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-foreground">Install App</div>
          <button
            type="button"
            className="rounded-lg border border-teal-500 px-3 py-1.5 text-sm text-foreground"
            onClick={() => setShowInstallHelp(false)}
          >
            Exit
          </button>
        </div>
        <div className="text-sm text-muted">
          Install only from this login page (<span className="font-display text-foreground">/</span>) so the app
          launches correctly.
        </div>

        {installPlatform === "ios" ? (
          <div className="text-sm text-muted space-y-1">
            <div>1. Open this login page in Safari.</div>
            <div>2. Tap Share.</div>
            <div>3. Tap Add to Home Screen.</div>
            <div>4. Confirm Add.</div>
          </div>
        ) : installPlatform === "android" ? (
          <div className="text-sm text-muted space-y-1">
            <div>1. Stay on this login page.</div>
            {deferredPrompt ? (
              <button
                type="button"
                onClick={runAndroidInstallPrompt}
                className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground"
              >
                Install Now
              </button>
            ) : (
              <div>2. Open browser menu and tap Install app / Add to Home screen.</div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted">Use your browser menu and add this login page to the home screen.</div>
        )}
      </AnimatedModal>
    </div>
  );
}
