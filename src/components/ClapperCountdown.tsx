// The pre-record countdown, as a film clapperboard instead of plain 3-2-1
// numbers. On each beat the clapper arm snaps shut (a "clap") with a camera
// flash, and the classic on-set call runs across the three counts:
// 3 → "Lights", 2 → "Camera", 1 → "Action!". Ties into the Cinema Dub logo.
//
// Driven purely by the `count` prop (3, 2, 1). Re-keying on `count` replays the
// clap + flash every beat. Overlays its video container (absolute inset-0).

export function ClapperCountdown({ count }: { count: number }) {
  const label = count >= 3 ? "Lights" : count === 2 ? "Camera" : "Action!";
  const isAction = count <= 1;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[inherit] bg-black/60">
      <style>{`
        .cd-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;animation:cd-flash .9s ease-out both;}
        @keyframes cd-flash{0%,12%{opacity:0}16%{opacity:.72}30%{opacity:0}100%{opacity:0}}
        .cd-stage{position:relative;width:clamp(108px,34vw,158px);filter:drop-shadow(3px 4px 0 rgba(17,0,45,.55));}
        .cd-arm{transform-box:view-box;transform-origin:17px 40px;transform:rotate(-26deg);animation:cd-clap .9s cubic-bezier(.3,.85,.35,1) both;}
        @keyframes cd-clap{0%{transform:rotate(-26deg)}16%{transform:rotate(0deg)}24%{transform:rotate(-4deg)}42%{transform:rotate(-26deg)}100%{transform:rotate(-26deg)}}
        .cd-label{font-family:var(--font-fredoka),system-ui,sans-serif;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:var(--color-cream);text-shadow:0 2px 10px rgba(0,0,0,.6);animation:cd-pop .9s ease-out both;}
        @keyframes cd-pop{0%{transform:scale(.7);opacity:0}18%{transform:scale(1.12);opacity:1}34%{transform:scale(1)}100%{transform:scale(1);opacity:1}}
        @media (prefers-reduced-motion: reduce){.cd-flash,.cd-arm,.cd-label{animation:none}.cd-arm{transform:rotate(-18deg)}}
      `}</style>

      <div key={`f${count}`} className="cd-flash" />

      <div key={`s${count}`} className="cd-stage">
        <svg viewBox="0 0 100 100" width="100%" role="img" aria-label={`${label} — recording in ${count}`}>
          {/* slate board */}
          <rect x="14" y="44" width="72" height="42" rx="7" fill="#fff6ec" stroke="#201255" strokeWidth="4" />
          <path d="M41 55 L41 75 L60 65 Z" fill="#ff3d8b" stroke="#201255" strokeWidth="3" strokeLinejoin="round" />

          {/* fixed jaw */}
          <rect x="13" y="37" width="74" height="10" rx="3" fill="#2a0845" stroke="#201255" strokeWidth="4" />
          <g stroke="#fff6ec" strokeWidth="6" strokeLinecap="round">
            <line x1="26" y1="38" x2="21" y2="46" />
            <line x1="42" y1="38" x2="37" y2="46" />
            <line x1="58" y1="38" x2="53" y2="46" />
            <line x1="74" y1="38" x2="69" y2="46" />
          </g>

          {/* hinged arm (claps) */}
          <g className="cd-arm">
            <rect x="12" y="23" width="80" height="15" rx="4" fill="#2a0845" stroke="#201255" strokeWidth="4" />
            <g stroke="#fff6ec" strokeWidth="6" strokeLinecap="round">
              <line x1="26" y1="24" x2="20" y2="37" />
              <line x1="40" y1="24" x2="34" y2="37" />
              <line x1="54" y1="24" x2="48" y2="37" />
              <line x1="68" y1="24" x2="62" y2="37" />
              <line x1="82" y1="24" x2="76" y2="37" />
            </g>
          </g>
        </svg>
      </div>

      <div
        key={`l${count}`}
        className="cd-label"
        style={{ fontSize: isAction ? "clamp(22px,6vw,34px)" : "clamp(16px,4.5vw,24px)", color: isAction ? "var(--color-magenta)" : "var(--color-cream)" }}
      >
        {label}
      </div>
    </div>
  );
}
