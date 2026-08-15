"use client";

import { useEffect, useRef } from "react";
import { ADSENSE_CLIENT, ADSENSE_ENABLED, ADSENSE_SLOT_RAIL } from "@/lib/adsense";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// Persistent left-hand ad rail, Gartic-Phone style. Lives in the root layout so
// it mounts ONCE and never re-renders on client navigation — the same ad stays
// static on screen across the landing page, dashboard, game and every other
// route. All the "is there room for it / shift the page right" logic lives in
// CSS (see .ad-rail + the --ad-rail var in globals.css): the rail is hidden and
// the page is full-width below the desktop breakpoint, so phones get no ad and
// no wasted gutter.
// Matches the breakpoint in globals.css where the rail becomes visible.
const RAIL_QUERY = "(min-width: 1200px)";

export function AdRail() {
  // AdSense wants exactly one push() per <ins>. Because this component is
  // mounted once for the app's lifetime, a ref guard is enough to make sure a
  // Fast-Refresh / StrictMode double-invoke can't request the slot twice.
  const requested = useRef(false);

  useEffect(() => {
    if (!ADSENSE_ENABLED) return;

    const request = () => {
      // Only ask for the ad once the rail is actually on screen — requesting it
      // while the unit is display:none (mobile) makes AdSense log a "no slot
      // size" error and can waste an impression.
      if (requested.current || !window.matchMedia(RAIL_QUERY).matches) return;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        requested.current = true;
      } catch {
        // Blocked by an ad-blocker or the loader failed — leave the gutter empty.
      }
    };

    request();
    // If we started narrow (rail hidden), request the ad the first time the
    // viewport grows past the breakpoint instead of leaving the gutter blank.
    const mql = window.matchMedia(RAIL_QUERY);
    mql.addEventListener("change", request);
    return () => mql.removeEventListener("change", request);
  }, []);

  if (!ADSENSE_ENABLED) return null;

  return (
    <aside className="ad-rail" aria-label="Advertisement">
      <ins
        className="adsbygoogle ad-rail-unit"
        // Responsive vertical unit: AdSense reads the rendered width of the rail
        // and serves the biggest vertical size that fits (160x600 on a normal
        // desktop, up to 300x600 on wide screens) instead of a locked size.
        // Sizing lives in CSS (.ad-rail-unit) so the container drives it.
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT_RAIL}
        data-ad-format="vertical"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
