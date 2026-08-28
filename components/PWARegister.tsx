"use client";

import { useEffect } from "react";
import { migratePersistentRoomCache } from "@/lib/sessionCache";

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    migratePersistentRoomCache();
    if (!("serviceWorker" in navigator)) return;
    const isProd = process.env.NODE_ENV === "production";

    if (!isProd) {
      // Avoid stale chunks/HMR issues in dev.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister().catch(() => {}));
      });
      return;
    }

    let reloading = false;
    let registration: ServiceWorkerRegistration | null = null;
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        void registration?.update().catch(() => {});
      }
    };
    const onLoad = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        await registration.update();
      } catch {
        // The app remains fully usable without installation/offline support.
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);
    const updateTimer = window.setInterval(checkForUpdate, 60 * 60 * 1000);

    if (document.readyState === "complete") {
      onLoad();
      return () => {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        window.removeEventListener("focus", checkForUpdate);
        document.removeEventListener("visibilitychange", checkForUpdate);
        window.clearInterval(updateTimer);
      };
    }

    window.addEventListener("load", onLoad);
    return () => {
      window.removeEventListener("load", onLoad);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.clearInterval(updateTimer);
    };
  }, []);

  return null;
}
