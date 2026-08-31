// Monetag "In-Page Push (Banner)" config. The zone id is public by design (it
// ships in the tag on every page), so it's safe to hardcode a default and allow
// a per-deploy env override.
//
// This format is a single self-injecting <script>: Monetag renders a FLOATING
// native banner and positions it itself — there is no size or position to set
// here, and none in code (the dashboard exposes none either).
export const MONETAG_ZONE = process.env.NEXT_PUBLIC_MONETAG_ZONE || "11694269";
export const MONETAG_SRC = "https://nap5k.com/tag.min.js";
export const MONETAG_ENABLED = Boolean(MONETAG_ZONE);

// Hosts where the tag must NOT load: localhost/dev. Off-domain it never fills
// (Monetag serves only the approved live domain) and can generate invalid
// impressions that risk the account — so injection is skipped there. The ad is
// therefore visible only on the live site.
export function isAdHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;
  if (hostname.endsWith(".local")) return false;
  return true;
}
