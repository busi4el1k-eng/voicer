// Cinema Dub brand mark: a film clapperboard — the "start the scene" symbol —
// with its top arm raised open (about to clap = action!) and a magenta play
// triangle on the slate to reinforce "start / playback". Drawn in the app's
// Gartic register: chunky shapes, dark multi-safe outline, hard offset shadow,
// zero blur. Pure inline SVG so it stays crisp at any size and needs no asset.

export function Logo({
  className,
  title = "Cinema Dub",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title}
      style={{
        display: "block",
        overflow: "visible",
        filter: "drop-shadow(3px 3px 0 rgba(8,34,48,0.55))",
      }}
    >
      <defs>
        {/* Diagonal cream stripes, clipped to each clapper bar. */}
        <clipPath id="cd-arm-clip">
          <rect x="12" y="23" width="80" height="15" rx="4" />
        </clipPath>
        <clipPath id="cd-jaw-clip">
          <rect x="13" y="37" width="74" height="10" rx="3" />
        </clipPath>
      </defs>

      {/* Slate board */}
      <rect x="14" y="44" width="72" height="42" rx="7" fill="#fff6ec" stroke="#0a2b3d" strokeWidth="4" />
      {/* Play triangle — "start" */}
      <path d="M41 55 L41 75 L60 65 Z" fill="#f7941d" stroke="#0a2b3d" strokeWidth="3" strokeLinejoin="round" />

      {/* Fixed lower jaw of the clapper (striped) */}
      <g>
        <rect x="13" y="37" width="74" height="10" rx="3" fill="#0c2e42" stroke="#0a2b3d" strokeWidth="4" />
        <g clipPath="url(#cd-jaw-clip)" stroke="#fff6ec" strokeWidth="7">
          <line x1="26" y1="35" x2="20" y2="49" />
          <line x1="42" y1="35" x2="36" y2="49" />
          <line x1="58" y1="35" x2="52" y2="49" />
          <line x1="74" y1="35" x2="68" y2="49" />
        </g>
      </g>

      {/* Hinged top arm, raised open on the left pivot (striped) */}
      <g transform="rotate(-13 17 41)">
        <rect x="12" y="23" width="80" height="15" rx="4" fill="#0c2e42" stroke="#0a2b3d" strokeWidth="4" />
        <g clipPath="url(#cd-arm-clip)" stroke="#fff6ec" strokeWidth="7">
          <line x1="24" y1="21" x2="16" y2="40" />
          <line x1="40" y1="21" x2="32" y2="40" />
          <line x1="56" y1="21" x2="48" y2="40" />
          <line x1="72" y1="21" x2="64" y2="40" />
          <line x1="88" y1="21" x2="80" y2="40" />
        </g>
      </g>
    </svg>
  );
}
