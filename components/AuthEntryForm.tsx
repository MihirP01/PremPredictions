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
    <div className="min-h-[100dvh] bg-app px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-4 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,16,31,0.92)_0%,rgba(8,16,31,0.78)_100%)] p-4 shadow-card sm:gap-6 sm:p-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(145deg,rgba(56,189,248,0.12)_0%,rgba(15,23,42,0.92)_38%,rgba(8,16,31,0.96)_100%)] p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-12 top-6 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.32)_0%,rgba(56,189,248,0)_70%)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.22)_0%,rgba(20,184,166,0)_74%)]" />
          <div className="relative z-[1] space-y-6">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-display uppercase tracking-[0.24em] text-muted">
              PL Predictions
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
                Matchday decisions, built like a control room.
              </h1>
              <p className="max-w-md text-sm leading-6 text-muted sm:text-base">
                Join your room, track live fixtures, run the minigame, and keep standings tight without touching any backend setup.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Live overlays", "Fixture state updates without reloading the full view"],
                ["Room-first flow", "Faster return paths into the exact state players left"],
                ["Home-screen ready", "Install directly from this page for the clean app shell"],
              ].map(([label, copy]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  <div className="text-[11px] font-display uppercase tracking-[0.2em] text-muted">{label}</div>
                  <div className="mt-2 text-sm text-foreground/90">{copy}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,19,36,0.96)_0%,rgba(8,16,31,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-7">
          <div className="space-y-5">
            <div className="inline-flex rounded-2xl border border-white/8 bg-white/[0.03] p-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("signin")}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  mode === "signin"
                    ? "bg-[linear-gradient(180deg,rgba(56,189,248,0.2)_0%,rgba(56,189,248,0.08)_100%)] text-foreground"
                    : "text-muted",
                ].join(" ")}
              >
                Sign in
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("signup")}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  mode === "signup"
                    ? "bg-[linear-gradient(180deg,rgba(56,189,248,0.2)_0%,rgba(56,189,248,0.08)_100%)] text-foreground"
                    : "text-muted",
                ].join(" ")}
              >
                Create account
              </button>
            </div>

            <div>
              <div className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
                {mode === "signin" ? "Welcome back" : "Create your profile"}
              </div>
              <div className="mt-2 text-sm text-muted">
                {mode === "signin"
                  ? "Use your existing credentials to reopen your rooms."
                  : "Set your player identity once, then join or create rooms immediately."}
              </div>
            </div>

            <div className="space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-display uppercase tracking-[0.2em] text-muted">
                    Display name
                  </label>
                  <input
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                    value={displayName}
                    disabled={busy}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Player Name"
                    autoComplete="nickname"
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-display uppercase tracking-[0.2em] text-muted">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@email.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-display uppercase tracking-[0.2em] text-muted">
                  Password
                </label>
                <input
                  type="password"
                  className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  inputMode="text"
                />
              </div>
            </div>

            {error ? <div className="rounded-2xl border border-rose-400/25 bg-rose-500/8 px-4 py-3 text-sm text-danger">{error}</div> : null}

            <button
              onClick={submit}
              disabled={busy}
              className="w-full rounded-2xl bg-[linear-gradient(180deg,rgba(56,189,248,1)_0%,rgba(14,165,233,0.92)_100%)] px-4 py-3 font-semibold text-accent-foreground shadow-[0_16px_24px_rgba(14,165,233,0.22)] disabled:opacity-60"
            >
              {busy ? "Please wait…" : mode === "signin" ? "Enter workspace" : "Create account"}
            </button>

            <button
              onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
              disabled={busy}
              className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-muted disabled:opacity-60"
            >
              {mode === "signin" ? "Need an account? Switch to sign up" : "Already have an account? Switch to sign in"}
            </button>

            {isPhone ? (
              <button
                type="button"
                onClick={() => setShowInstallHelp(true)}
                className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-foreground hover:bg-white/[0.05]"
              >
                Add to home screen
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <AnimatedModal
        open={showInstallHelp}
        onClose={() => setShowInstallHelp(false)}
        portal
        lockBackground
        closeOnBackdrop={false}
        zIndexClassName="z-[90]"
        overlayClassName="bg-[rgba(2,8,23,0.72)] backdrop-blur-md"
        panelClassName="w-full max-w-md rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,19,36,0.98)_0%,rgba(8,16,31,0.94)_100%)] p-5 space-y-4 shadow-[0_28px_50px_rgba(2,8,23,0.48)]"
      >
        <div className="flex items-center justify-between">
          <div className="font-display text-xl font-semibold text-foreground">Install App</div>
          <button
            type="button"
            className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground"
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
