"use client";

import { useRef, useState } from "react";
import { VideoStage } from "@/components/VideoStage";

// A podium clip's video icon. It shows a still frame only — no auto-play preview
// on hover or on scroll. Click / tap opens the full dub in a player (with sound).
// A ▶ badge marks that it's playable.
const STILL_AT = 0.5; // seconds — the idle frame

export function ClipThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);

  const showStill = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.min(STILL_AT, (v.duration || STILL_AT * 2) / 2);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Watch clip"
        className="group relative block cursor-pointer overflow-hidden rounded-[10px] border-2 border-violet-lift bg-black shadow-[0_4px_0_0_rgba(8,34,48,0.5)]"
        style={{ width: 150 }}
      >
        <video
          ref={ref}
          src={`${src}#t=${STILL_AT}`}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={showStill}
          className="h-[90px] w-[150px] object-cover transition-transform duration-200 group-hover:scale-105"
        />
        {/* ▶ badge — signals the clip is playable (click / tap to watch). */}
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/55 text-[13px] text-cream shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            ▶
          </span>
        </span>
      </button>

      {/* Full-clip player, opened by click / tap. */}
      {open && (
        <div className="g-modal-overlay" onClick={() => setOpen(false)}>
          <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-magenta font-display text-[18px] font-black text-cream shadow-[0_2px_0_rgba(8,34,48,0.5)]"
            >
              ×
            </button>
            <VideoStage src={src} autoPlay />
          </div>
        </div>
      )}
    </>
  );
}
