"use client";

import React, { useEffect, useRef, useState } from "react";

type PendulumNameProps = {
  text: string;
  windowPx?: number | null;
  className?: string;
};

export default function PendulumName({
  text,
  windowPx = 56,
  className = "",
}: PendulumNameProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [panPx, setPanPx] = useState(0);

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const inner = innerRef.current;
      if (!wrap || !inner) return;
      const overflow = Math.max(0, Math.ceil(inner.scrollWidth - wrap.clientWidth));
      setPanPx(overflow);
    };

    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text]);

  const isAnimated = panPx > 2;
  const durationSec = Math.min(14, Math.max(7, 7 + panPx / 20));

  return (
    <div
      ref={wrapRef}
      className={`team-name-scroll ${isAnimated ? "is-animated" : ""} ${className}`}
      style={
        {
          ...(windowPx != null
            ? {
                width: `${windowPx}px`,
                minWidth: `${windowPx}px`,
                maxWidth: `${windowPx}px`,
              }
            : {}),
          textOverflow: "ellipsis",
          "--team-pan": `${panPx}px`,
          "--team-pan-duration": `${durationSec}s`,
        } as React.CSSProperties
      }
    >
      <span ref={innerRef} className="team-name-scroll-inner">
        {text}
      </span>
    </div>
  );
}
