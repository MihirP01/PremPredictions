"use client";

import { useEffect, useRef } from "react";

function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const type = (el.type || "text").toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }
  if (el instanceof HTMLElement) return el.isContentEditable;
  return false;
}

export default function InputFocusScrollLock() {
  const lockedRef = useRef(false);
  const scrollYRef = useRef(0);
  const prevRef = useRef<{
    bodyOverflow: string;
    bodyPosition: string;
    bodyTop: string;
    bodyWidth: string;
    htmlOverflow: string;
  } | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const body = document.body;
    const lockClass = "input-focus-scroll-lock";

    const lock = () => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      scrollYRef.current = window.scrollY;
      prevRef.current = {
        bodyOverflow: body.style.overflow,
        bodyPosition: body.style.position,
        bodyTop: body.style.top,
        bodyWidth: body.style.width,
        htmlOverflow: root.style.overflow,
      };
      root.classList.add(lockClass);
      body.classList.add(lockClass);
      root.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = `-${scrollYRef.current}px`;
      body.style.width = "100%";
    };

    const unlock = () => {
      if (!lockedRef.current) return;
      lockedRef.current = false;
      const prev = prevRef.current;
      root.classList.remove(lockClass);
      body.classList.remove(lockClass);
      if (prev) {
        root.style.overflow = prev.htmlOverflow;
        body.style.overflow = prev.bodyOverflow;
        body.style.position = prev.bodyPosition;
        body.style.top = prev.bodyTop;
        body.style.width = prev.bodyWidth;
      } else {
        root.style.overflow = "";
        body.style.overflow = "";
        body.style.position = "";
        body.style.top = "";
        body.style.width = "";
      }
      window.scrollTo(0, scrollYRef.current);
      prevRef.current = null;
    };

    const syncLock = () => {
      const active = document.activeElement;
      const shouldLock = isTextEntryElement(active);
      if (shouldLock) lock();
      else unlock();
    };

    const onFocusIn = () => syncLock();
    const onFocusOut = () => {
      // Wait for next activeElement after blur/focus transition.
      window.setTimeout(syncLock, 0);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!lockedRef.current) return;
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent) => {
      if (!lockedRef.current) return;
      event.preventDefault();
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("wheel", onWheel, { passive: false });
    syncLock();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("wheel", onWheel);
      unlock();
    };
  }, []);

  return null;
}
