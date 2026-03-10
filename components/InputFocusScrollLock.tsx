"use client";

import { useEffect, useRef } from "react";

function isTextEntryElement(el: Element | null): el is HTMLElement {
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
  return el instanceof HTMLElement && el.isContentEditable;
}

function isTextFocusProxyTarget(el: Element | null): el is HTMLElement {
  if (!isTextEntryElement(el)) return false;
  return !(el instanceof HTMLInputElement && el.type.toLowerCase() === "number");
}

function findTextFocusProxyTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (isTextFocusProxyTarget(target)) return target;
  const candidate = target.closest(
    "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
  );
  return candidate instanceof HTMLElement && isTextFocusProxyTarget(candidate)
    ? candidate
    : null;
}

function isInsideModalPanel(el: Element | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  return !!el.closest("[data-modal-panel='true']");
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
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const root = document.documentElement;
    const body = document.body;
    const lockClass = "input-focus-scroll-lock";
    const modalInputClass = "modal-input-active";
    const textInputClass = "text-input-active";
    const keyboardOpenClass = "keyboard-open";
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
    const preventKeyboardScroll = (event: TouchEvent | WheelEvent) => {
      event.preventDefault();
    };
    let keyboardScrollLocked = false;

    const setInputClasses = (active: boolean, inModal: boolean) => {
      root.classList.toggle(textInputClass, active);
      body.classList.toggle(textInputClass, active);
      root.classList.toggle(modalInputClass, active && inModal);
      body.classList.toggle(modalInputClass, active && inModal);
    };

    const keyboardInset = () => {
      const viewport = window.visualViewport;
      if (!viewport) return 0;
      return Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop));
    };

    const setKeyboardOpen = (active: boolean) => {
      root.classList.toggle(keyboardOpenClass, active);
      body.classList.toggle(keyboardOpenClass, active);
      if (active === keyboardScrollLocked) return;
      keyboardScrollLocked = active;
      if (active) {
        document.addEventListener("touchmove", preventKeyboardScroll, {
          passive: false,
        });
        document.addEventListener("wheel", preventKeyboardScroll, {
          passive: false,
        });
        return;
      }
      document.removeEventListener("touchmove", preventKeyboardScroll);
      document.removeEventListener("wheel", preventKeyboardScroll);
    };

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

    const syncState = () => {
      const active = document.activeElement;
      const shouldMark = isTextEntryElement(active);
      const inModal = isInsideModalPanel(active);
      setInputClasses(!!shouldMark, inModal);

      if (isTouchDevice) {
        unlock();
        setKeyboardOpen(!!shouldMark || keyboardInset() > 120);
        return;
      }

      setKeyboardOpen(false);
      if (!shouldMark || inModal) {
        unlock();
        return;
      }
      lock();
    };

    const focusWithoutScroll = (target: HTMLElement) => {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
      if (
        target instanceof HTMLInputElement &&
        typeof target.setSelectionRange === "function"
      ) {
        const type = (target.type || "text").toLowerCase();
        if (["text", "search", "url", "tel", "password", "email"].includes(type)) {
          const len = target.value.length;
          target.setSelectionRange(len, len);
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isTouchDevice || event.pointerType === "mouse") return;
      const target = findTextFocusProxyTarget(event.target);
      if (!target) return;
      if (document.activeElement !== target) {
        event.preventDefault();
        event.stopPropagation();
        setInputClasses(true, isInsideModalPanel(target));
        setKeyboardOpen(true);
        focusWithoutScroll(target);
      } else {
        setInputClasses(true, isInsideModalPanel(target));
        setKeyboardOpen(true);
      }
      window.setTimeout(syncState, 0);
    };

    const onFocusIn = () => syncState();
    const onFocusOut = () => window.setTimeout(syncState, 0);
    const onViewportChange = () => {
      if (!isTouchDevice) return;
      syncState();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!lockedRef.current) return;
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent) => {
      if (!lockedRef.current) return;
      event.preventDefault();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("wheel", onWheel, { passive: false });
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    syncState();

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("wheel", onWheel);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      setKeyboardOpen(false);
      root.classList.remove(textInputClass);
      body.classList.remove(textInputClass);
      root.classList.remove(modalInputClass);
      body.classList.remove(modalInputClass);
      root.classList.remove(keyboardOpenClass);
      body.classList.remove(keyboardOpenClass);
      unlock();
    };
  }, []);

  return null;
}
