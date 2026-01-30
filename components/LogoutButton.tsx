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
      className="text-sm border rounded-lg px-3 py-2 disabled:opacity-60"
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
