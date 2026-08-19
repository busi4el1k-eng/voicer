"use client";

import { useRef, useState } from "react";
import { VideoStage } from "@/components/VideoStage";
import { useCenterPreview } from "@/lib/useCenterPreview";

// A podium clip's video icon. Small by default; hovering (mouse) plays a short
// muted preview and scales it up. To watch the FULL dub with sound:
//   • mouse  — click the icon.
//   • touch  — first tap enlarges the preview, a second tap on the same clip
//              opens the player (press-and-hold opens it straight away too).
// A little ▶ badge marks that it's playable.
const STILL_AT = 0.5; // seconds — the idle frame
const PREVIEW_SECONDS = 4; // loop the opening seconds while previewing
const HOLD_MS = 450; // press-and-hold threshold to open the full player

export function ClipThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const openedByHold = useRef(false);

  const showStill = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.min(STILL_AT, (v.duration || STILL_AT * 2) / 2);
  };
  const startPreview = () => {
    setHover(true);
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };
  const stopPreview = () => {
    setHover(false);
    const v = ref.current;
    if (!v) return;
    v.pause();
    showStill();
  };
  const onTime = () => {
    const v = ref.current;
    if (v && v.currentTime > PREVIEW_SECONDS) v.currentTime = 0;
  };

  // On mobile (no hover), preview while this clip is centred on screen. Skip
  // while the full player is open (the thumb is hidden behind the modal).
  useCenterPreview(
    wrapRef,
    () => {
      if (!open) startPreview();
    },
    stopPreview,
  );

  const openPlayer = () => {
    stopPreview();
    setOpen(true);
  };

  // Touch: hold to open the full player; a quick tap just toggles the preview.
  const onTouchStart = () => {
    openedByHold.current = false;
    holdTimer.current = window.setTimeout(() => {
      openedByHold.current = true;
      openPlayer();
    }, HOLD_MS);
  };
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    cancelHold();
    // Stop the synthetic mouse click a tap would otherwise fire.
    e.preventDefault();
    if (openedByHold.current) return; // hold already opened it
    // First tap enlarges the preview; tapping the already-enlarged clip opens it.
    if (hover) openPlayer();
    else startPreview();
  };

  return (
    <>
      <div
        ref={wrapRef}
        className="group relative flex cursor-pointer justify-center"
        style={{ width: 72 }}
      >
        <video
          ref={ref}
          src={`${src}#t=${STILL_AT}`}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={showStill}
          onMouseEnter={startPreview}
          onMouseLeave={stopPreview}
          onClick={openPlayer}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchMove={cancelHold}
          onTimeUpdate={onTime}
          className="h-11 w-[72px] cursor-pointer rounded-[8px] border-2 border-violet-lift bg-black object-cover transition-transform duration-200"
          style={{
            transform: hover ? "scale(2.9)" : "scale(1)",
            transformOrigin: "center",
            position: "relative",
            zIndex: hover ? 30 : 1,
            boxShadow: hover ? "0 12px 34px rgba(0,0,0,0.55)" : "none",
          }}
        />
        {/* ▶ badge — signals the icon is playable (tap/click to watch). Hidden
            while enlarged so it doesn't cover the preview. */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 grid place-items-center transition-opacity ${
            hover ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-ink/55 text-[9px] text-cream shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            ▶
          </span>
        </span>
      </div>

      {/* Full-clip player, opened by click / hold. Autostarts with sound (the
          opening gesture is what permits audio autoplay). */}
      {open && (
        <div className="g-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="relative w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-magenta font-display text-[18px] font-black text-cream shadow-[0_2px_0_rgba(17,0,69,0.5)]"
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
