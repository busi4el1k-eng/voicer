// Adsterra ad config for the persistent left rail. The "key" is public by
// design (it ships in the invoke.js URL on every page), so it's safe to hardcode
// a default and allow a per-deploy env override.
//
// This is a fixed 160x300 iframe banner (the unit you created in Adsterra).
// Swap KEY/WIDTH/HEIGHT here if you generate a different unit (e.g. a 160x600
// skyscraper) — the rail CSS sizes itself from these numbers.
export const ADSTERRA_KEY =
  process.env.NEXT_PUBLIC_ADSTERRA_KEY || "f8fdfbbabf7896fb92fef80aa5fa3f9e";
export const ADSTERRA_WIDTH = 160;
export const ADSTERRA_HEIGHT = 300;

export const ADSTERRA_ENABLED = Boolean(ADSTERRA_KEY);

// Adsterra "Native Banner" — a responsive block shown UNDER the content on
// mobile/tablet (where the fixed side rail is hidden). It's a different format:
// an async invoke.js that fills a <div id="container-{KEY}"> it finds in the DOM.
export const ADSTERRA_NATIVE_KEY =
  process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_KEY || "42edcc9b168c0f0a22a855610fa6379e";
export const ADSTERRA_NATIVE_SRC = `https://pl30927413.effectivecpmnetwork.com/${ADSTERRA_NATIVE_KEY}/invoke.js`;
export const ADSTERRA_NATIVE_ENABLED = Boolean(ADSTERRA_NATIVE_KEY);
