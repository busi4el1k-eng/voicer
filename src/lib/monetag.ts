// Monetag "In-Page Push (Banner)" config. The zone id is public by design (it
// ships in the tag on every page), so it's safe to hardcode a default and allow
// a per-deploy env override.
export const MONETAG_ZONE = process.env.NEXT_PUBLIC_MONETAG_ZONE || "11694269";
export const MONETAG_SRC = "https://nap5k.com/tag.min.js";

// Only load the ad tag in production builds. In dev (`next dev`, NODE_ENV
// !== "production") it stays off so localhost never fires the tag or generates
// invalid impressions.
export const MONETAG_ENABLED =
  Boolean(MONETAG_ZONE) && process.env.NODE_ENV === "production";

// Monetag's exact self-injecting snippet, rendered INLINE in the server HTML (not
// injected client-side): it creates a <script>, stamps the zone on it, points it
// at tag.min.js, and appends it. Rendering it in the raw HTML is what lets
// Monetag's "Check installation" crawler detect the tag — a client-side useEffect
// injection isn't present in the fetched HTML, so verification fails there.
export function monetagSnippet(): string {
  return `(function(s){s.dataset.zone='${MONETAG_ZONE}',s.src='${MONETAG_SRC}'})([document.documentElement,document.body].filter(Boolean).pop().appendChild(document.createElement('script')))`;
}
