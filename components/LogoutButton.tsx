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
        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-red-200 shadow-[0_10px_24px_rgba(3,8,20,0.18)] transition hover:border-white/16 hover:bg-white/[0.06] disabled:opacity-60"
      >
        {busy ? "Logging out..." : "Log out"}
      </button>
      <AnimatedModal
        open={confirmOpen}
        onClose={() => (busy ? null : setConfirmOpen(false))}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-[rgba(4,12,24,0.62)] backdrop-blur-sm"
        panelClassName="w-full max-w-sm rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] p-4 shadow-[0_24px_56px_rgba(3,8,20,0.4)]"
      >
        <div className="space-y-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
          <div className="font-display text-lg font-semibold text-foreground">Log Out</div>
          <div className="text-sm text-muted">Are you sure you want to log out?</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={busy}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground transition hover:border-white/16 hover:bg-white/[0.06] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={doLogout}
            disabled={busy}
            className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
          >
            Confirm Log Out
          </button>
        </div>
      </AnimatedModal>
    </>
  );
}
