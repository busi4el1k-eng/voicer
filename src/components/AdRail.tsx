"use client";

import { useEffect } from "react";
import { MONETAG_ENABLED, MONETAG_SRC, MONETAG_ZONE, isAdHost } from "@/lib/monetag";

// Monetag In-Page Push (Banner). This is the exact self-injecting snippet Monetag
// hands you: set `data-zone` on a <script>, point it at tag.min.js, append it —
// Monetag then renders a floating native banner and positions it itself.
//
// Mounted once from the root layout so it survives client navigation and never
// double-loads. Only injected on the live domain (see isAdHost) so dev/localhost
// never generates invalid impressions. Renders nothing into the DOM tree itself;
// the ad is a floating overlay Monetag draws and controls.
export function AdRail() {
  useEffect(() => {
    if (!MONETAG_ENABLED) return;
    if (!isAdHost(window.location.hostname)) return;
    if (document.querySelector(`script[data-zone="${MONETAG_ZONE}"]`)) return;

    const s = document.createElement("script");
    s.dataset.zone = MONETAG_ZONE;
    s.src = MONETAG_SRC;
    (document.body || document.documentElement).appendChild(s);
  }, []);

  return null;
}
