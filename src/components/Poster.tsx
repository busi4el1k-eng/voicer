"use client";

import { useEffect, useRef, useState } from "react";
import { useCenterPreview } from "@/lib/useCenterPreview";

// A big, full-width video frame (16:9). Shows a still frame at rest and plays a
// short muted preview on hover (desktop) or when scrolled to centre (see
// useCenterPreview). A small sound toggle sits in the bottom-left: previews
// always start muted (so autoplay is allowed everywhere); tapping it unmutes the
// clip you're currently watching. The size never changes — it's a preview.
const STILL_AT = 0.5; // seconds — the frame shown when idle
const PREVIEW_SECONDS = 4; // loop the opening few seconds while previewing

export function Poster({ src }: { src: string }) {
  // The always-present frame (reserves layout + is what the observers watch). The
  // heavy <video> inside is mounted lazily — see `active` below.
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  // Sound state for the mute toggle. Previews always (re)start muted — that's
  // what lets them autoplay without a gesture — so this resets to true on play().
  const [muted, setMuted] = useState(true);

  // Only mount the <video> (which fetches the MP4's metadata + first frame) once
  // the card nears the viewport, so a page of cards doesn't fire dozens of video
  // loads on paint — the thing that made the library heavy to open. Latches on:
  // a page holds few cards, so once shown we keep it mounted (no reload thrash).
  const [active, setActive] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || active) return;
    if (!("IntersectionObserver" in window)) {
      // No observer support (very old browser): just mount it, deferred so we
      // don't set state synchronously inside the effect body.
      const id = requestAnimationFrame(() => setActive(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActive(true);
          io.disconnect();
        }
      },
      // Start loading a bit before it scrolls in, so the still frame is ready.
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active]);

  // Seek to a frame so a still image shows even before playback.
  const showStill = () => {
    const v = ref.current;
    if (v) v.currentTime = Math.min(STILL_AT, (v.duration || 1) / 2);
  };

  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // always start muted so autoplay is permitted
    setMuted(true);
    v.currentTime = 0;
    void v.play().catch(() => {});
  };
  const stop = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    showStill();
  };

  // The sound toggle: unmute/mute the clip that's currently previewing. Tapping
  // is a user gesture, so unmuting is allowed. Stop the event from reaching the
  // video (whose tap toggles the preview) so this only changes sound.
  const toggleSound = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    // If they unmuted while it wasn't playing, start it so there's sound to hear.
    if (!v.muted && v.paused) void v.play().catch(() => {});
  };

  // Touch devices have no hover: a tap toggles the preview. preventDefault stops
  // the browser also firing a synthetic mouseenter that would re-trigger it.
  const onTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    const v = ref.current;
    if (!v) return;
    if (v.paused) play();
    else stop();
  };

  // Keep the preview short by looping the opening seconds.
  const onTime = () => {
    const v = ref.current;
    if (v && v.currentTime > PREVIEW_SECONDS) v.currentTime = 0;
  };

  // On mobile AND desktop, auto-play the preview while this poster is centred on
  // screen — so scrolling the library previews whatever you're looking at. We
  // watch the wrapper (always present); play/stop no-op until the video mounts.
  useCenterPreview(wrapRef, play, stop);

  return (
    <div ref={wrapRef} className="relative aspect-video w-full overflow-hidden bg-black">
      {active && (
        <>
          <video
            ref={ref}
            src={`${src}#t=${STILL_AT}`}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={showStill}
            onMouseEnter={play}
            onMouseLeave={stop}
            onTouchStart={onTouch}
            onTimeUpdate={onTime}
            className="absolute inset-0 h-full w-full cursor-pointer object-cover"
          />

          {/* Sound toggle — bottom-left corner. 🔇 muted (default) → tap to unmute. */}
          <button
            type="button"
            onClick={toggleSound}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label={muted ? "Unmute preview" : "Mute preview"}
            className="absolute bottom-2 left-2 grid h-8 w-8 place-items-center rounded-full bg-ink/60 text-[14px] text-cream backdrop-blur-sm transition-transform active:scale-90"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </>
      )}
    </div>
  );
}
