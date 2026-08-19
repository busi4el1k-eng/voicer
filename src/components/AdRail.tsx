"use client";

import { ADSTERRA_ENABLED, ADSTERRA_HEIGHT, ADSTERRA_KEY, ADSTERRA_WIDTH } from "@/lib/adsterra";

// Persistent ad rail, Gartic-Phone style. Lives in the root layout so it mounts
// ONCE and never re-renders on client navigation — the same ad stays static on
// screen across the landing page, dashboard, game and every other route. All the
// "is there room for it / shift the page" logic lives in CSS (see .ad-rail + the
// --ad-rail var in globals.css): the rail is hidden and the page is full-width
// below the desktop breakpoint, so phones get no ad and no wasted gutter.
//
// Adsterra's snippet is a global `atOptions` object plus an `invoke.js` that
// injects the ad next to itself — both awkward to drop into React directly. We
// isolate them inside a same-document iframe (srcDoc) so their script can't
// touch the app, can't be duplicated by a re-render, and renders at exactly the
// unit's size. No frame/card/label — just the clean ad.
function adSrcDoc() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body><script type="text/javascript">atOptions={'key':'${ADSTERRA_KEY}','format':'iframe','height':${ADSTERRA_HEIGHT},'width':${ADSTERRA_WIDTH},'params':{}};</script><script type="text/javascript" src="https://www.highperformanceformat.com/${ADSTERRA_KEY}/invoke.js"></script></body></html>`;
}

export function AdRail() {
  if (!ADSTERRA_ENABLED) return null;

  return (
    <aside className="ad-rail" aria-label="Advertisement">
      <iframe
        title="Advertisement"
        className="ad-rail-unit"
        width={ADSTERRA_WIDTH}
        height={ADSTERRA_HEIGHT}
        scrolling="no"
        frameBorder={0}
        srcDoc={adSrcDoc()}
      />
    </aside>
  );
}
