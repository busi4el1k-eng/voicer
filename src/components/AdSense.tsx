"use client";

import { useEffect } from "react";

// Loads the Google AdSense library on every page. We inject it imperatively after
// mount (this component renders nothing) so it can never cause a hydration
// mismatch — unlike a `next/script` tag, whose SSR/`beforeInteractive` injection
// collided with PostHog's runtime script insertion. AdSense's crawler renders
// JavaScript, so it still detects the tag; actual ad units / Auto ads are
// controlled in the AdSense account, not here.
const ADSENSE_SRC =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6096361350236947";

export function AdSense() {
  useEffect(() => {
    // Guard against a double insert (e.g. fast client navigations / re-mounts).
    if (document.getElementById("google-adsense-js")) return;
    const s = document.createElement("script");
    s.id = "google-adsense-js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = ADSENSE_SRC;
    document.head.appendChild(s);
  }, []);
  return null;
}
