// Bespoke line-art icons for the game modes and the "how to play" steps.
// These replace the stock emoji so nothing looks generated: chunky, rounded,
// one consistent stroke, drawn to sit inside the embossed .g-ficon chip.

const PATHS = {
  // ── modes ──
  creator: `<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="6" r="2.6"/><path d="M8 8l9 9M16 8l-9 9"/>`,
  library: `<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 9.5h16M4 14.5h16M9 6v12M15 6v12"/>`,
  party: `<path d="M4 20l4-11 6 6-10 5z"/><path d="M13 4c2 0 2 2 4 2M15 8c2 0 2 2 4 2"/><circle cx="18" cy="14" r="1"/><circle cx="20.5" cy="18" r="1"/>`,
  // two crossed blades — the Duel icon
  duel: `<path d="M5 5 L15 15"/><path d="M13 17 L17 13"/><path d="M15 15 L18.5 18.5"/><circle cx="19.2" cy="19.2" r="1.1"/><path d="M19 5 L9 15"/><path d="M7 13 L11 17"/><path d="M9 15 L5.5 18.5"/><circle cx="4.8" cy="19.2" r="1.1"/>`,
  solo: `<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M4 9l3-4 4 4M11 5l4 4M15 5l4 4"/><circle cx="12" cy="15" r="2.4"/>`,
  soon: `<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/><circle cx="12" cy="15.5" r="1.3"/>`,
  // ── steps (landing "how to play") ──
  listen: `<path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3.5" y="13" width="4" height="6" rx="1.6"/><rect x="16.5" y="13" width="4" height="6" rx="1.6"/>`,
  perform: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4M9 21h6"/>`,
  judged: `<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1"/><circle cx="9.5" cy="13" r="1.2"/><circle cx="14.5" cy="13" r="1.2"/><path d="M9.5 16.5h5"/>`,
  win: `<path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/><path d="M8 5.5H5.5V7a3 3 0 0 0 3 3M16 5.5h2.5V7a3 3 0 0 1-3 3"/><path d="M12 12v3M9.5 20h5l-.6-4h-3.8z"/>`,
  // ── landing feature highlights ──
  friends: `<circle cx="8.5" cy="8" r="2.6"/><circle cx="16" cy="9.5" r="2.1"/><path d="M4 19a4.5 4.5 0 0 1 9 0M13.5 19a4 4 0 0 1 6.5-3.1"/>`,
  favorite: `<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 9.5h16"/><path d="M12 16.2l-2.4-2.1a1.5 1.5 0 1 1 2.4-1.7 1.5 1.5 0 1 1 2.4 1.7z"/>`,
  share: `<circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="M8.1 10.9l7.3-3.7M8.1 13.1l7.3 3.7"/>`,
} as const;

export type GameIconName = keyof typeof PATHS;

export function GameIcon({ name, size = 32 }: { name: GameIconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="#ffe9d2"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
