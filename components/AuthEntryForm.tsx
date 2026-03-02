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

  const inputClassName =
    "w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-foreground placeholder:text-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition focus:border-white/20 focus:bg-black/30";

  return (
    <div className="min-h-[100dvh] bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-6xl gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(155deg,rgba(13,18,31,0.98),rgba(31,14,42,0.96)_55%,rgba(57,24,13,0.94))] px-6 py-8 shadow-[0_32px_90px_rgba(5,4,18,0.55)] sm:px-8 sm:py-10">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <div className="pointer-events-none absolute left-0 top-12 h-48 w-48 rounded-full bg-fuchsia-400/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="relative z-[1] flex h-full flex-col justify-between gap-10">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-white/10 bg-black/20 px-4 py-2 font-display text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-white/60">
                Matchday Control
              </div>
              <div className="space-y-3">
                <h1 className="max-w-xl font-display text-[clamp(3rem,8vw,6rem)] font-semibold leading-[0.88] text-foreground">
                  Predict with a live-room flow.
                </h1>
                <p className="max-w-lg text-sm leading-7 text-white/68 sm:text-base">
                  This concept pushes the app toward a motion-first companion panel: live fixtures, room decisions,
                  and results feel like one continuous control surface instead of separate pages.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Live Rooms", "Jump between active rooms without leaving the deck."],
                ["Fast Picks", "Use matchday flows that stay focused on the current action."],
                ["Shared State", "Leaderboard, stats, and fixtures stay visually synchronized."],
              ].map(([label, body]) => (
                <div
                  key={label}
                  className="rounded-[24px] border border-white/8 bg-black/15 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <div className="font-display text-sm font-semibold text-foreground">{label}</div>
                  <div className="mt-2 text-xs leading-6 text-white/60">{body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(145deg,rgba(10,13,23,0.98),rgba(18,12,28,0.98)_52%,rgba(37,18,10,0.95))] p-5 shadow-[0_32px_90px_rgba(5,4,18,0.55)] sm:p-6 lg:p-8">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="relative z-[1] flex h-full flex-col gap-5">
            <div className="flex items-center justify-between rounded-[22px] border border-white/8 bg-black/15 p-1.5">
              {([
                ["signin", "Sign In"],
                ["signup", "Create"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={busy}
                  className={[
                    "flex-1 rounded-[18px] px-4 py-3 text-sm font-semibold transition",
                    mode === value
                      ? "bg-[linear-gradient(135deg,#f472b6,#fb7185,#f59e0b)] text-slate-950 shadow-[0_10px_22px_rgba(0,0,0,0.2)]"
                      : "text-white/55 hover:text-foreground",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="font-display text-2xl font-semibold text-foreground">
                {mode === "signin" ? "Enter your room system" : "Create your access profile"}
              </div>
              <div className="text-sm leading-6 text-white/60">
                Use your existing credentials to rejoin your rooms instantly, or create a new profile for matchday.
              </div>
            </div>

            <div className="space-y-4">
              {mode === "signup" ? (
                <div className="space-y-2">
                  <label className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                    Full Name
                  </label>
                  <input
                    className={inputClassName}
                    value={displayName}
                    disabled={busy}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Player Name"
                    autoComplete="nickname"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Email
                </label>
                <input
                  type="email"
                  className={inputClassName}
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

              <div className="space-y-2">
                <label className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Password
                </label>
                <input
                  type="password"
                  className={inputClassName}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  inputMode="text"
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-2xl bg-[linear-gradient(135deg,#f472b6,#fb7185,#f59e0b)] px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_16px_28px_rgba(0,0,0,0.24)] transition disabled:opacity-60"
              >
                {busy ? "Please wait..." : mode === "signin" ? "Enter" : "Create Account"}
              </button>

              <button
                onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
                disabled={busy}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-white/20 hover:bg-black/30 disabled:opacity-60"
              >
                {mode === "signin" ? "Need an account?" : "Already registered?"}
              </button>
            </div>

            {isPhone ? (
              <button
                type="button"
                onClick={() => setShowInstallHelp(true)}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-white/20 hover:bg-black/30"
              >
                Add to Home Screen
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <AnimatedModal
        open={showInstallHelp}
        onClose={() => setShowInstallHelp(false)}
        portal
        lockBackground
        closeOnBackdrop={false}
        zIndexClassName="z-[90]"
        overlayClassName="bg-[radial-gradient(circle_at_top,rgba(244,114,182,0.15),transparent_35%),rgba(4,6,14,0.82)] backdrop-blur-md"
        panelClassName="w-full max-w-sm rounded-[28px] border border-white/10 bg-[linear-gradient(155deg,rgba(12,15,26,0.98),rgba(31,14,42,0.98)_55%,rgba(50,20,11,0.95))] p-4 shadow-[0_28px_90px_rgba(3,2,16,0.62)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/50">Install</div>
            <div className="font-display text-lg font-semibold text-foreground">Home Screen Setup</div>
          </div>
          <button
            type="button"
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-foreground transition hover:border-white/20 hover:bg-black/30"
            onClick={() => setShowInstallHelp(false)}
          >
            Exit
          </button>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-black/15 p-4 text-sm leading-7 text-white/65">
          Install only from this login page (<span className="font-display text-foreground">/</span>) so the app launches correctly.
        </div>

        {installPlatform === "ios" ? (
          <div className="rounded-[22px] border border-white/8 bg-black/15 p-4 text-sm leading-7 text-white/65">
            <div>1. Open this login page in Safari.</div>
            <div>2. Tap Share.</div>
            <div>3. Tap Add to Home Screen.</div>
            <div>4. Confirm Add.</div>
          </div>
        ) : installPlatform === "android" ? (
          <div className="space-y-3 rounded-[22px] border border-white/8 bg-black/15 p-4 text-sm leading-7 text-white/65">
            <div>1. Stay on this login page.</div>
            {deferredPrompt ? (
              <button
                type="button"
                onClick={runAndroidInstallPrompt}
                className="w-full rounded-2xl bg-[linear-gradient(135deg,#f472b6,#fb7185,#f59e0b)] px-4 py-3 font-semibold text-slate-950"
              >
                Install Now
              </button>
            ) : (
              <div>2. Open browser menu and tap Install app / Add to Home screen.</div>
            )}
          </div>
        ) : (
          <div className="rounded-[22px] border border-white/8 bg-black/15 p-4 text-sm leading-7 text-white/65">
            Use your browser menu and add this login page to the home screen.
          </div>
        )}
      </AnimatedModal>
    </div>
  );
}
