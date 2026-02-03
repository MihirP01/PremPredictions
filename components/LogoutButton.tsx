"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { auth } from "../firebase";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const doLogout = async () => {
    const confirmed = window.confirm("Are you sure you want to log out?");
    if (!confirmed) return;

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
  );
}
