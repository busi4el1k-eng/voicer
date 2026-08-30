"use client";

import { useRef, useState } from "react";
import { VideoStage } from "@/components/VideoStage";
import { ClipReactions } from "@/components/ClipReactions";

// A podium clip's video icon. Idle it shows a still frame with a ▶ badge.
//
// Desktop: moving the mouse over it (no click needed) enlarges the clip and
// plays a short, muted preview looping the opening seconds — no sound. Clicking
// opens the full dub in the player, with sound.
//
// Touch: no hover, so the first tap enlarges + previews, and a second tap opens
// the full player.
const STILL_AT = 0.5; // seconds — the idle frame
const PREVIEW_SECONDS = 4; // loop the opening few seconds while previewing

export function ClipThumb({ src, clipId }: { src: string; clipId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(false);

  // Seek to a frame so a still image shows even before playback.
  const showStill = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.min(STILL_AT, (v.duration || STILL_AT * 2) / 2);
  };

  const startPreview = () => {
    setPreview(true);
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };

  const stopPreview = () => {
    setPreview(false);
    const v = ref.current;
    if (!v) return;
    v.pause();
    showStill();
  };

  const openPlayer = () => {
    const v = ref.current;
    if (v) v.pause();
    setOpen(true);
  };

  const closePlayer = () => {
    setOpen(false);
    stopPreview();
  };

  // Keep the preview short by looping the opening seconds.
  const onTime = () => {
    const v = ref.current;
    if (v && v.currentTime > PREVIEW_SECONDS) v.currentTime = 0;
  };

  // Mouse (desktop): hovering already enlarged + previewed the clip, so a click
  // just opens the player.
  const onClick = () => {
    openPlayer();
  };

  // Touch (mobile): no hover, so tap once to enlarge + preview, tap again to
  // open the player. preventDefault stops the browser also firing a synthetic
  // click that would immediately re-trigger it.
  const onTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    if (preview) openPlayer();
    else startPreview();
  };

  return (
    <>
      <button
        type="button"
        onMouseEnter={startPreview}
        onMouseLeave={stopPreview}
        onClick={onClick}
        onTouchStart={onTouch}
        aria-label={preview ? "Watch clip" : "Preview clip"}
        className="group relative block w-full max-w-[150px] cursor-pointer overflow-hidden rounded-[10px] border-2 border-violet-lift bg-black shadow-[0_4px_0_0_rgba(8,34,48,0.5)] transition-transform duration-200"
        style={{
          transform: preview ? "scale(1.6)" : "scale(1)",
          transformOrigin: "center",
          position: "relative",
          zIndex: preview ? 30 : 1,
          boxShadow: preview ? "0 14px 36px rgba(0,0,0,0.55)" : undefined,
        }}
      >
        <video
          ref={ref}
          src={`${src}#t=${STILL_AT}`}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={showStill}
          onTimeUpdate={onTime}
          className="aspect-[5/3] w-full object-cover"
        />
        {/* ▶ badge — signals the clip is playable. Hidden while previewing. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-200"
          style={{ opacity: preview ? 0 : 1 }}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/55 text-[13px] text-cream shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            ▶
          </span>
        </span>
      </button>

      {/* Full-clip player, opened by click / second tap. */}
      {open && (
        <div className="g-modal-overlay" onClick={closePlayer}>
          <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close"
              onClick={closePlayer}
              className="absolute -top-3 -right-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-magenta font-display text-[18px] font-black text-cream shadow-[0_2px_0_rgba(8,34,48,0.5)]"
            >
              ×
            </button>
            <VideoStage src={src} autoPlay />
            <ClipReactions clipId={clipId} />
          </div>
        </div>
      )}
    </>
  );
}
