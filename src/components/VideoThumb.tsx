"use client";

import { useRef, useState } from "react";
import { useCenterPreview } from "@/lib/useCenterPreview";

// A tiny still frame pulled from the uploaded video. Hovering plays a short,
// muted preview (looping the first few seconds) and scales the frame up a bit.
const STILL_AT = 0.5; // seconds — the frame shown when idle
const PREVIEW_SECONDS = 4; // loop the opening few seconds while hovering

export function VideoThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);

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

  // Touch devices have no hover: a tap toggles the enlarged preview on/off.
  // preventDefault stops the browser also firing a synthetic mouseenter that
  // would immediately re-toggle it.
  const onTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    if (hover) onLeave();
    else onEnter();
  };

  // Keep the preview short by looping the opening seconds.
  const onTime = () => {
    const v = ref.current;
    if (v && v.currentTime > PREVIEW_SECONDS) v.currentTime = 0;
  };

  // On mobile (no hover), play the preview while this thumb is centred on screen.
  useCenterPreview(wrapRef, onEnter, onLeave);

  return (
    // On phones the frame is centred across the full row width, so the zoom
    // grows from the middle of the screen and its edges stay on-screen. On
    // desktop (sm+) it's a compact fixed-width cell at the left of the row.
    <div ref={wrapRef} className="flex w-full justify-center sm:w-[100px]">
      <video
        ref={ref}
        src={`${src}#t=${STILL_AT}`}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={showStill}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
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
    </div>
  );
}
