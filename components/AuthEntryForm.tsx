"use client";

import React, { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
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
  const [installPlatform, setInstallPlatform] =
    useState<InstallPlatform>("other");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const evaluateDevice = () => {
      if (typeof window === "undefined") return;
      const ua = window.navigator.userAgent || "";
      const platform = window.navigator.platform || "";
      const touchPoints =
        (window.navigator as Navigator & { maxTouchPoints?: number })
          .maxTouchPoints ?? 0;

      const iosPhone = /iPhone|iPod/i.test(ua);
      const androidPhone = /Android/i.test(ua);
      const standalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        Boolean(
          (window.navigator as Navigator & { standalone?: boolean }).standalone,
        );
      const smallScreen =
        window.matchMedia?.("(max-width: 900px)")?.matches ?? false;
      const mobileLike =
        iosPhone || androidPhone || (/Mac/i.test(platform) && touchPoints > 1);

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
    return () =>
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
  }, []);

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
    "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-foreground placeholder:text-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-white/16 focus:bg-white/[0.06]";

  return (
    <div className="min-h-[100dvh] bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-6xl gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(160deg,rgba(9,18,34,0.96),rgba(10,27,46,0.94)_55%,rgba(14,45,63,0.92))] px-6 py-8 shadow-[0_28px_70px_rgba(3,8,20,0.42)] sm:px-8 sm:py-10">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
          <div className="pointer-events-none absolute right-8 top-8 h-24 w-24 rounded-full bg-sky-300/8 blur-3xl" />
          <div className="relative z-[1] flex h-full flex-col justify-between gap-10">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/58">
                Premium Match Hub
              </div>
              <div className="space-y-3">
                <h1 className="max-w-xl font-display text-[clamp(2.8rem,7vw,5.4rem)] font-semibold leading-[0.92] text-foreground">
                  A cleaner control room for every matchday.
                </h1>
                <p className="max-w-lg text-sm leading-7 text-white/62 sm:text-base">
                  This concept reduces clutter, keeps room controls predictable,
                  and makes the product feel like a polished SaaS dashboard
                  instead of a raw utility.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                [
                  "Room Access",
                  "Sign in and return to the exact room context you left.",
                ],
                [
                  "Stable Navigation",
                  "Core routes stay visible and predictable across devices.",
                ],
                [
                  "Low Friction",
                  "The interface prioritizes the next useful action, not decoration.",
                ],
              ].map(([label, body]) => (
                <div
                  key={label}
                  className="rounded-3xl border border-white/8 bg-white/[0.03] p-4"
                >
                  <div className="font-display text-sm font-semibold text-foreground">
                    {label}
                  </div>
                  <div className="mt-2 text-xs leading-6 text-white/55">
                    {body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] p-5 shadow-[0_28px_70px_rgba(3,8,20,0.42)] sm:p-6 lg:p-8">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
          <div className="relative z-[1] flex h-full flex-col gap-5">
            <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-1.5">
              {(
                [
                  ["signin", "Sign In"],
                  ["signup", "Create Account"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={busy}
                  className={[
                    "flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    mode === value
                      ? "bg-white/[0.08] text-foreground"
                      : "text-white/55 hover:text-foreground",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="font-display text-2xl font-semibold text-foreground">
                {mode === "signin"
                  ? "Access your room dashboard"
                  : "Create your player profile"}
              </div>
              <div className="text-sm leading-6 text-white/58">
                Authentication, routing, and room membership stay the same. Only
                the control surface changes.
              </div>
            </div>

            <div className="space-y-4">
              {mode === "signup" ? (
                <div className="space-y-2">
                  <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
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
                <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
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
                <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Password
                </label>
                <input
                  type="password"
                  className={inputClassName}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  inputMode="text"
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-[0_16px_28px_rgba(3,8,20,0.24)] transition disabled:opacity-60"
              >
                {busy
                  ? "Please wait..."
                  : mode === "signin"
                    ? "Enter Dashboard"
                    : "Create Account"}
              </button>
              <button
                onClick={() =>
                  setMode((m) => (m === "signin" ? "signup" : "signin"))
                }
                disabled={busy}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-foreground transition hover:border-white/16 hover:bg-white/[0.06] disabled:opacity-60"
              >
                {mode === "signin" ? "Need an account?" : "Already registered?"}
              </button>
            </div>

            {isPhone ? (
              <button
                type="button"
                onClick={() => setShowInstallHelp(true)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-foreground transition hover:border-white/16 hover:bg-white/[0.06]"
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
        overlayClassName="bg-[rgba(4,12,24,0.62)] backdrop-blur-sm"
        panelClassName="w-full max-w-sm rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,24,0.98),rgba(10,18,32,0.96))] p-4 shadow-[0_24px_56px_rgba(3,8,20,0.4)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/45">
              Install
            </div>
            <div className="font-display text-lg font-semibold text-foreground">
              Home Screen Setup
            </div>
          </div>
          <button
            type="button"
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-foreground transition hover:border-white/16 hover:bg-white/[0.06]"
            onClick={() => setShowInstallHelp(false)}
          >
            Exit
          </button>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-white/60">
          Install only from this login page (
          <span className="font-display text-foreground">/</span>) so the app
          launches correctly.
        </div>

        {installPlatform === "ios" ? (
          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-white/60">
            <div>1. Open this login page in Safari.</div>
            <div>2. Tap Share.</div>
            <div>3. Tap Add to Home Screen.</div>
            <div>4. Confirm Add.</div>
          </div>
        ) : installPlatform === "android" ? (
          <div className="space-y-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-white/60">
            <div>1. Stay on this login page.</div>
            {deferredPrompt ? (
              <button
                type="button"
                onClick={runAndroidInstallPrompt}
                className="w-full rounded-2xl bg-accent px-4 py-3 font-semibold text-accent-foreground"
              >
                Install Now
              </button>
            ) : (
              <div>
                2. Open browser menu and tap Install app / Add to Home screen.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-white/60">
            Use your browser menu and add this login page to the home screen.
          </div>
        )}
      </AnimatedModal>
    </div>
  );
}
