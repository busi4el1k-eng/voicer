"use client";

import { useRef, useState } from "react";
import { VideoStage } from "@/components/VideoStage";

// A tiny still frame pulled from the uploaded video. Hovering (desktop) or
// tapping (mobile) plays a short, muted preview (looping the first few seconds)
// and scales the frame up a bit. The preview never auto-plays on its own — it
// only runs while the mouse is on it, or after an explicit tap.
//
// With `playable`, it also opens the full app player (with sound) — clicking the
// hovered/enlarged frame on desktop, or a second tap on touch — same logic as
// the podium clips, just without the reactions bar.
const STILL_AT = 0.5; // seconds — the frame shown when idle
const PREVIEW_SECONDS = 4; // loop the opening few seconds while hovering

export function VideoThumb({ src, playable = false }: { src: string; playable?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);

  // Seek to a frame so a still image shows even before playback.
  const showStill = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.min(STILL_AT, (v.duration || STILL_AT * 2) / 2);
  };

  const onEnter = () => {
    setHover(true);
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };

  const onLeave = () => {
    setHover(false);
    const v = ref.current;
    if (!v) return;
    v.pause();
    showStill();
  };

  // Open the full player (playable only). Pause the muted preview first.
  const openPlayer = () => {
    const v = ref.current;
    if (v) v.pause();
    setOpen(true);
  };

  const closePlayer = () => {
    setOpen(false);
    onLeave();
  };

  // Mouse (desktop): hovering already enlarged + previewed the clip, so a click
  // just opens the player (playable only).
  const onClick = () => {
    if (playable) openPlayer();
  };

  // Touch devices have no hover: a tap toggles the enlarged preview on/off.
  // preventDefault stops the browser also firing a synthetic mouseenter that
  // would immediately re-toggle it. When `playable`, the first tap enlarges +
  // previews and a second tap (while enlarged) opens the full player.
  const onTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    if (playable) {
      if (hover) openPlayer();
      else onEnter();
    } else if (hover) onLeave();
    else onEnter();
  };

  // Keep the preview short by looping the opening seconds.
  const onTime = () => {
    const v = ref.current;
    if (v && v.currentTime > PREVIEW_SECONDS) v.currentTime = 0;
  };

  return (
    // On phones the frame is centred across the full row width, so the zoom
    // grows from the middle of the screen and its edges stay on-screen. On
    // desktop (sm+) it's a compact fixed-width cell at the left of the row.
    <div className="flex w-full justify-center sm:w-[100px]">
      <video
        ref={ref}
        src={`${src}#t=${STILL_AT}`}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={showStill}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
        onTouchStart={onTouch}
        onTimeUpdate={onTime}
        className="h-[60px] w-[100px] cursor-pointer rounded-[8px] border-2 border-violet-lift bg-black object-cover transition-transform duration-200"
        style={{
          transform: hover ? "scale(2.9)" : "scale(1)",
          transformOrigin: "center",
          position: "relative",
          zIndex: hover ? 30 : 1,
          boxShadow: hover ? "0 12px 34px rgba(0,0,0,0.55)" : "none",
        }}
      />

      {/* Full player, opened by click / second tap. No reactions bar. */}
      {playable && open && (
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
          </div>
        </div>
      )}
    </div>
  );
}
