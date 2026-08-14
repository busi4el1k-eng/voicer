"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

// Links analytics events to a signed-in player. On mount it asks the backend who
// the current user is (GET /api/user) and, when signed in, calls
// posthog.identify() with the internal User.id — never email/PII. Guests (and
// anyone who signs out) are reset back to an anonymous person. No-ops entirely
// when PostHog isn't configured. Renders nothing.
export function PostHogIdentify() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/user");
        if (!r.ok) return;
        const { id } = (await r.json()) as { id: string | null };
        if (cancelled) return;
        if (id) {
          // Only re-identify if this is a new distinct id, to avoid churn.
          if (posthog.get_distinct_id() !== id) posthog.identify(id);
        } else if (posthog._isIdentified()) {
          posthog.reset();
        }
      } catch {
        /* analytics is best-effort — never surface an error to the player */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
