export function triggerTapHaptic() {
  if (typeof window === "undefined") return;
  const nav = window.navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(10);
  } catch {
    // no-op: some browsers expose vibrate but block it at runtime
  }
}
