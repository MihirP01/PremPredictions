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
        className="
          w-full
          text-sm
          font-bold
          px-3 py-2
          rounded-lg
          border border-teal-500
          bg-surface
          text-danger
          hover:bg-surface-2
          disabled:opacity-60
          transition

          focus:outline-none
          focus-visible:ring-2
          focus-visible:ring-teal-500
          focus-visible:ring-offset-2
          focus-visible:ring-offset-surface
        "
      >
        {busy ? "Logging out…" : "Log out"}
      </button>
      <AnimatedModal
        open={confirmOpen}
        onClose={() => (busy ? null : setConfirmOpen(false))}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-sm rounded-2xl border border-teal-500 bg-surface p-4 space-y-4"
      >
        <div className="text-lg font-semibold text-foreground">Log Out</div>
        <div className="text-sm text-muted">Are you sure you want to log out?</div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={busy}
            className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={doLogout}
            disabled={busy}
            className="text-sm rounded-lg px-3 py-2 bg-surface border border-teal-500 text-danger hover:bg-surface-2 disabled:opacity-60"
          >
            Confirm Log Out
          </button>
        </div>
      </AnimatedModal>
    </>
  );
}
