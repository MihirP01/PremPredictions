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
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-semibold text-red-300 shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition duration-150 hover:border-red-300/20 hover:bg-black/30 disabled:opacity-60"
      >
        {busy ? "Logging out..." : "Log out"}
      </button>
      <AnimatedModal
        open={confirmOpen}
        onClose={() => (busy ? null : setConfirmOpen(false))}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-[radial-gradient(circle_at_top,rgba(244,114,182,0.15),transparent_35%),rgba(4,6,14,0.82)] backdrop-blur-md"
        panelClassName="w-full max-w-sm rounded-[28px] border border-white/10 bg-[linear-gradient(155deg,rgba(12,15,26,0.98),rgba(31,14,42,0.98)_55%,rgba(50,20,11,0.95))] p-4 shadow-[0_28px_90px_rgba(3,2,16,0.62)]"
      >
        <div className="space-y-3 rounded-[22px] border border-white/8 bg-black/15 p-4">
          <div className="font-display text-xl font-semibold text-foreground">Log Out</div>
          <div className="text-sm text-muted">Are you sure you want to log out?</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={busy}
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground transition hover:border-white/20 hover:bg-black/30 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={doLogout}
            disabled={busy}
            className="rounded-2xl bg-[linear-gradient(135deg,#ef4444,#f97316)] px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
          >
            Confirm Log Out
          </button>
        </div>
      </AnimatedModal>
    </>
  );
}
