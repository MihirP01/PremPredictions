"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  confirmPasswordReset,
  verifyPasswordResetCode,
} from "firebase/auth";
import { Loader2 } from "lucide-react";
import { auth } from "@/firebase";
import { authErrorMessage, normalizeAuthEmail } from "@/lib/authErrors";
import { sendAppPasswordResetEmail } from "@/lib/passwordReset";

const inputClassName =
  "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-foreground placeholder:text-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-white/16 focus:bg-white/[0.06]";

type Phase = "checking" | "invalid" | "expired" | "form" | "success";

export default function PasswordResetScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oobCode = searchParams.get("oobCode")?.trim() || "";
  const mode = searchParams.get("mode")?.trim() || "";

  const [phase, setPhase] = useState<Phase>("checking");
  const [accountEmail, setAccountEmail] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (mode && mode !== "resetPassword") {
      setPhase("invalid");
      setError("This reset link is invalid.");
      return;
    }
    if (!oobCode) {
      setPhase("invalid");
      setError("This reset link is invalid.");
      return;
    }

    setPhase("checking");
    setError(null);
    void verifyPasswordResetCode(auth, oobCode)
      .then((email) => {
        if (cancelled) return;
        setAccountEmail(email);
        setResendEmail(email);
        setPhase("form");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPhase("expired");
        setError(
          authErrorMessage(e, "This reset link is invalid or has expired."),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    if (!password) {
      setError("Enter a new password.");
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setPhase("success");
    } catch (e: unknown) {
      setError(
        authErrorMessage(e, e instanceof Error ? e.message : "Could not update password."),
      );
    } finally {
      setBusy(false);
    }
  };

  const sendNewLink = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextEmail = normalizeAuthEmail(resendEmail);
    setResendEmail(nextEmail);
    setError(null);
    setNotice(null);
    if (!nextEmail) {
      setError("Enter your email first, then send a new link.");
      return;
    }
    setBusy(true);
    try {
      await sendAppPasswordResetEmail(nextEmail);
      setNotice("Check that inbox for a new reset link.");
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : authErrorMessage(e, "Could not send a reset email."),
      );
    } finally {
      setBusy(false);
    }
  };

  const title =
    phase === "success"
      ? "Password updated"
      : phase === "form"
        ? "Set a new password"
        : phase === "expired"
          ? "Link expired"
          : phase === "invalid"
            ? "Invalid link"
            : "Checking link";

  const subtitle =
    phase === "success"
      ? "Sign in with your new password. If you use the home-screen app, open that and sign in there."
      : phase === "form"
        ? "Choose a password for this account."
        : phase === "expired"
          ? "Ask for a new email, then use the latest link."
          : phase === "invalid"
            ? "Open Forgot password on the sign-in page to get a new link."
            : "Checking this reset link.";

  return (
    <div className="min-h-[100dvh] bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md flex-col justify-center gap-6">
        <div className="space-y-2 text-center">
          <h1 className="font-display text-3xl font-semibold text-foreground">
            PL Predictions
          </h1>
          <p className="text-sm leading-6 text-white/58">Reset your password</p>
        </div>

        <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] p-5 shadow-[0_28px_70px_rgba(3,8,20,0.42)] sm:p-6">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
          <div className="relative z-[1] flex flex-col gap-5">
            <div className="space-y-2">
              <div className="font-display text-2xl font-semibold text-foreground">
                {title}
              </div>
              <div className="text-sm leading-6 text-white/58">{subtitle}</div>
            </div>

            {phase === "checking" ? (
              <div className="inline-flex items-center gap-2 text-sm text-white/60">
                <Loader2 size={16} className="animate-spin" />
                Please wait...
              </div>
            ) : null}

            {phase === "form" ? (
              <form className="space-y-4" onSubmit={(event) => void submitNewPassword(event)}>
                <div className="space-y-2">
                  <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                    Email
                  </label>
                  <input
                    type="email"
                    className={inputClassName}
                    value={accountEmail}
                    readOnly
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                    New password
                  </label>
                  <input
                    type="password"
                    className={inputClassName}
                    value={password}
                    disabled={busy}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    className={inputClassName}
                    value={confirm}
                    disabled={busy}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                {error ? (
                  <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-[0_16px_28px_rgba(3,8,20,0.24)] transition disabled:opacity-60"
                >
                  {busy ? "Please wait..." : "Update password"}
                </button>
              </form>
            ) : null}

            {phase === "expired" ? (
              <form className="space-y-4" onSubmit={(event) => void sendNewLink(event)}>
                <div className="space-y-2">
                  <label className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/55">
                    Email
                  </label>
                  <input
                    type="email"
                    className={inputClassName}
                    value={resendEmail}
                    disabled={busy}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="name@email.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="email"
                  />
                </div>
                {notice ? (
                  <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    {notice}
                  </div>
                ) : null}
                {error ? (
                  <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-[0_16px_28px_rgba(3,8,20,0.24)] transition disabled:opacity-60"
                >
                  {busy ? "Please wait..." : "Send a new link"}
                </button>
              </form>
            ) : null}

            {phase === "invalid" && error ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            {phase === "success" ? (
              <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Password updated. Sign in with your new password.
              </div>
            ) : null}

            {phase !== "checking" ? (
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-foreground transition hover:border-white/16 hover:bg-white/[0.06]"
              >
                {phase === "success" ? "Sign in" : "Back to sign in"}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
