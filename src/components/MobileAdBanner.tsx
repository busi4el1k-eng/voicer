"use client";

import { useEffect, useRef } from "react";
import {
  ADSTERRA_NATIVE_ENABLED,
  ADSTERRA_NATIVE_KEY,
  ADSTERRA_NATIVE_SRC,
} from "@/lib/adsterra";

// Adsterra Native Banner shown UNDER the page content on mobile/tablet only —
// the desktop side rail (AdRail) is hidden there, so this fills the gap and
// every viewport gets exactly one ad. Lives in the root layout so it mounts
// once and the loader script runs a single time.
//
// The native format is an async invoke.js that scans the DOM for its
// <div id="container-{KEY}"> and injects the ad into it. We render that div
// inline (so the banner sizes to its natural height in normal flow) and append
// the script from an effect once the container exists.
const MOBILE_QUERY = "(max-width: 1199px)";

export function MobileAdBanner() {
  const loaded = useRef(false);

  useEffect(() => {
    if (!ADSTERRA_NATIVE_ENABLED) return;

    const mql = window.matchMedia(MOBILE_QUERY);
    const load = () => {
      // Only fetch the ad where it's actually shown (mobile/tablet). Loading it
      // on desktop would request an ad into a display:none container.
      if (loaded.current || !mql.matches) return;
      const script = document.createElement("script");
      script.async = true;
      script.setAttribute("data-cfasync", "false");
      script.src = ADSTERRA_NATIVE_SRC;
      document.body.appendChild(script);
      loaded.current = true;
    };

    load();
    // If we started on desktop, load the first time the viewport becomes mobile.
    mql.addEventListener("change", load);
    return () => mql.removeEventListener("change", load);
  }, []);

  if (!ADSTERRA_NATIVE_ENABLED) return null;

  return (
    <div className="ad-mobile" aria-label="Advertisement">
      <div id={`container-${ADSTERRA_NATIVE_KEY}`} />
    </div>
  );
}
