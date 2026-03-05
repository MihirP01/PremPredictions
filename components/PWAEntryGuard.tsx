"use client";

import { useEffect } from "react";

const SESSION_KEY = "pwa_entry_normalized_v1";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    Boolean(
      (window.navigator as Navigator & { standalone?: boolean }).standalone,
    )
  );
}

export default function PWAEntryGuard() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isStandalone()) return;

    // Normalize first app entry to `/` so install/launch context is consistent.
    const seen = window.sessionStorage.getItem(SESSION_KEY) === "1";
    if (seen) return;
    window.sessionStorage.setItem(SESSION_KEY, "1");

    if (window.location.pathname !== "/") {
      window.location.replace("/");
    }
  }, []);

  return null;
}
