"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { auth } from "../firebase";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const doLogout = async () => {
    setBusy(true);
    try {
      await signOut(auth);
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={doLogout}
      disabled={busy}
      className="
        text-sm
        px-3 py-2
        rounded-lg
        border border-subtle
        bg-surface
        text-foreground
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
  );
}
