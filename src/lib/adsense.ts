// Google AdSense config. The publisher (client) id is public by design — it
// ships in the loader <script> src on every page — so it's safe to hardcode a
// sensible default and still allow an env override per deploy.
//
// The RAIL slot id comes from a display ad unit you create in the AdSense
// dashboard (a 160x600 "wide skyscraper" / vertical unit). Until it's set, the
// left rail still reserves its space and shifts the page, but shows nothing —
// so the layout is verifiable before the unit exists.
export const ADSENSE_CLIENT =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "ca-pub-6096361350236947";

export const ADSENSE_SLOT_RAIL = process.env.NEXT_PUBLIC_ADSENSE_SLOT_RAIL || "";

// The rail (and page shift) only exist when we have a publisher id to load.
export const ADSENSE_ENABLED = Boolean(ADSENSE_CLIENT);
