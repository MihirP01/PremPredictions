"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { auth } from "../firebase";
import AnimatedModal from "./AnimatedModal";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();

  const doLogout = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      await signOut(auth);
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-danger hover:bg-white/[0.05] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {busy ? "Logging out…" : "Log out"}
      </button>
      <AnimatedModal
        open={confirmOpen}
        onClose={() => (busy ? null : setConfirmOpen(false))}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-[rgba(2,8,23,0.72)] backdrop-blur-md"
        panelClassName="w-full max-w-sm rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,19,36,0.98)_0%,rgba(8,16,31,0.94)_100%)] p-5 space-y-4 shadow-[0_28px_50px_rgba(2,8,23,0.48)]"
      >
        <div className="font-display text-xl font-semibold text-foreground">Log Out</div>
        <div className="text-sm text-muted">Are you sure you want to log out?</div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={busy}
            className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-foreground hover:bg-white/[0.05] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={doLogout}
            disabled={busy}
            className="rounded-xl border border-rose-400/30 bg-rose-500/8 px-3 py-2 text-sm text-danger hover:bg-rose-500/12 disabled:opacity-60"
          >
            Confirm Log Out
          </button>
        </div>
      </AnimatedModal>
    </>
  );
}
