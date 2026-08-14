// Client-side instrumentation (runs after the HTML loads, before React
// hydration). We use it to boot PostHog analytics. It's a no-op unless
// NEXT_PUBLIC_POSTHOG_KEY is set, so local dev / guests without the key are
// unaffected and nothing is sent.
//
// Events are sent to our own /ingest path (a reverse proxy configured in
// next.config.ts → PostHog EU cloud) so ad-blockers don't silently drop them.
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    // Same-origin proxy (see next.config.ts rewrites). ui_host makes the
    // "view in PostHog" links point at the real EU dashboard.
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    // Opt into PostHog's current sensible defaults (incl. SPA pageviews on
    // history changes and autocapture) in one pinned bundle.
    defaults: "2025-05-24",
    // Only create a person profile once someone is identified (a signed-in
    // user — see PostHogIdentify). Keeps guests anonymous and saves free-tier
    // quota.
    person_profiles: "identified_only",
    // Capture a $pageview on first load and on every client-side navigation.
    capture_pageview: "history_change",
  });
}
