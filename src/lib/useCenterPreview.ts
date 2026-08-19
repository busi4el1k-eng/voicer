"use client";

import { useEffect, useRef, type RefObject } from "react";

// Auto-run the muted preview when the thumbnail scrolls into the vertical CENTRE
// of the viewport (and stop it when it leaves) — so scrolling a list previews
// whatever clip you're looking at, no tap required. Muted + playsInline lets the
// video autoplay without a user gesture.
//
// Runs on every device (mobile AND desktop) so behaviour is identical
// everywhere; on desktop it simply works alongside the mouse hover (both just
// play/stop the same element). This is the single source of the scroll preview —
// there is no separate mobile-only code path.
export function useCenterPreview(
  elRef: RefObject<HTMLElement | null>,
  start: () => void,
  stop: () => void,
) {
  // Keep the latest callbacks in refs so the observer is created once (not
  // re-subscribed every render when the parent passes fresh closures).
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  // Refresh the refs after each render (not during it) so the observer always
  // calls the latest closures without being re-created.
  useEffect(() => {
    startRef.current = start;
    stopRef.current = stop;
  });

  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    // rootMargin shrinks the viewport to a thin band around the middle (top and
    // bottom 42% are excluded), so a thumb only counts as "in view" once it's
    // roughly centred on screen.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) startRef.current();
          else stopRef.current();
        }
      },
      { rootMargin: "-42% 0px -42% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [elRef]);
}
