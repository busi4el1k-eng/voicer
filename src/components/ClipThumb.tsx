"use client";

import { useRef, useState } from "react";
import { VideoStage } from "@/components/VideoStage";

// A podium clip's video icon. Small by default; hovering (mouse) plays a short
// muted preview and scales it up. To watch the FULL dub with sound, click it
// (mouse) or press-and-hold it (touch) — that opens an app-styled player modal
// that autostarts. A quick tap on mobile just toggles the muted preview.
const STILL_AT = 0.5; // seconds — the idle frame
const PREVIEW_SECONDS = 4; // loop the opening seconds while previewing
const HOLD_MS = 450; // press-and-hold threshold to open the full player

export function ClipThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
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
    // Stop the synthetic mouse click that a tap would otherwise fire (which would
    // open the player on a short tap instead of only on hold).
    e.preventDefault();
    if (openedByHold.current) return; // hold already opened it
    if (hover) stopPreview();
    else startPreview();
  };

  return (
    <>
      <div className="flex justify-center" style={{ width: 72 }}>
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
