"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// The app-styled video player used in the creator/editor — a `.g-player` shell
// with custom play/pause, scrub, mute and fullscreen controls (matching
// creator/[id]). Extracted so the play/party previews and dub studios reuse the
// exact same look instead of a bare <video>.
//
// Pass `sector` to restrict everything to a single sector: the player only
// plays that slice, the scrub bar spans just the sector, and it auto-stops at
// the sector end. Without `sector`, it behaves as a normal whole-video player.
// Exposes imperative `playSector`/`stop` for external buttons.

export type VideoStageHandle = {
  playSector: (startMs: number, endMs: number) => void;
  stop: () => void;
};

type Sector = { startMs: number; endMs: number };

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export const VideoStage = forwardRef<VideoStageHandle, { src?: string; sector?: Sector | null }>(
  function VideoStage({ src, sector }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<HTMLDivElement>(null);
    const stopAtRef = useRef<number | null>(null);
    const togglePlayRef = useRef<() => void>(() => {});

    const [playing, setPlaying] = useState(false);
    const [playhead, setPlayhead] = useState(0); // absolute ms
    const [durMs, setDurMs] = useState(0);
    const [muted, setMuted] = useState(false);
    // Loading state: `buffering` drives the spinner (initial load or a mid-play
    // stall), `bufferedMs` is how far the download has reached (grey seek fill).
    const [buffering, setBuffering] = useState(true);
    const [bufferedMs, setBufferedMs] = useState(0);

    // Sector mode maps the timeline onto [startMs, endMs); whole-video mode uses
    // the full duration.
    const base = sector ? sector.startMs : 0;
    const span = sector ? Math.max(1, sector.endMs - sector.startMs) : durMs;
    const rel = Math.min(span, Math.max(0, playhead - base));
    const frac = span > 0 ? rel / span : 0;
    // How much of the (sector or whole) timeline has downloaded, as a fraction.
    const bufFrac = span > 0 ? Math.min(1, Math.max(0, (bufferedMs - base) / span)) : 0;

    useImperativeHandle(ref, () => ({
      playSector(startMs: number, endMs: number) {
        const v = videoRef.current;
        if (!v) return;
        v.muted = false;
        setMuted(false);
        v.currentTime = startMs / 1000;
        setPlayhead(startMs);
        stopAtRef.current = endMs;
        void v.play().catch(() => {});
      },
      stop() {
        videoRef.current?.pause();
        stopAtRef.current = null;
      },
    }));

    // When the sector changes (or first loads), rewind to its start and pause.
    useEffect(() => {
      const v = videoRef.current;
      if (!v || !sector) return;
      const seek = () => {
        v.currentTime = sector.startMs / 1000;
        setPlayhead(sector.startMs);
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
      v.pause();
      stopAtRef.current = null;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sector?.startMs, sector?.endMs]);

    // A fresh source starts unloaded: show the spinner and reset the buffer bar
    // until the new video reports it can play.
    useEffect(() => {
      setBuffering(true);
      setBufferedMs(0);
    }, [src]);

    const onTimeUpdate = () => {
      const v = videoRef.current;
      if (!v) return;
      setPlayhead(v.currentTime * 1000);
      if (stopAtRef.current != null && v.currentTime * 1000 >= stopAtRef.current) {
        v.pause();
        stopAtRef.current = null;
      }
    };

    // Track how far the download has reached — the buffered range covering the
    // current position (like the grey bar in YouTube). Falls back to the last
    // range so the bar still advances when seeking around.
    const updateBuffered = () => {
      const v = videoRef.current;
      if (!v) return;
      const ranges = v.buffered;
      if (!ranges || ranges.length === 0) {
        setBufferedMs(0);
        return;
      }
      const ct = v.currentTime;
      let end = 0;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= ct + 0.25) end = Math.max(end, ranges.end(i));
      }
      if (end === 0) end = ranges.end(ranges.length - 1);
      setBufferedMs(end * 1000);
    };

    const applyDuration = () => {
      const v = videoRef.current;
      if (v && isFinite(v.duration) && v.duration > 0) setDurMs(Math.round(v.duration * 1000));
    };

    const togglePlay = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) {
        if (sector) {
          const ct = v.currentTime * 1000;
          if (ct < sector.startMs || ct >= sector.endMs - 20) v.currentTime = sector.startMs / 1000;
          stopAtRef.current = sector.endMs;
        } else {
          stopAtRef.current = null;
        }
        void v.play().catch(() => {});
      } else {
        v.pause();
      }
    };

    const toggleMute = () => {
      const v = videoRef.current;
      if (!v) return;
      v.muted = !v.muted;
      setMuted(v.muted);
    };

    const seekFrac = (f: number) => {
      const v = videoRef.current;
      if (!v || span <= 0) return;
      const t = base + Math.min(1, Math.max(0, f)) * span;
      v.currentTime = t / 1000;
      setPlayhead(t);
      stopAtRef.current = sector ? sector.endMs : null;
    };

    const onSeekBar = (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const at = (clientX: number) => seekFrac((clientX - rect.left) / rect.width);
      at(e.clientX);
      const move = (ev: PointerEvent) => at(ev.clientX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const toggleFullscreen = () => {
      const el = playerRef.current;
      if (!el) return;
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void el.requestFullscreen?.();
    };

    // Keep a live handle to togglePlay so the (stable) key listener always calls
    // the latest closure without re-subscribing every render.
    useEffect(() => {
      togglePlayRef.current = togglePlay;
    });

    // Space toggles play/pause (like the editor), unless you're typing.
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== "Space" && e.key !== " ") return;
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
        e.preventDefault();
        togglePlayRef.current();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
      <div
        ref={playerRef}
        className="g-player overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_2px_rgba(137,82,220,0.5)]"
      >
        {/* Video + a loading overlay that appears on first load or a mid-play
            stall. `preload="auto"` fetches ahead so playback is less likely to
            freeze. */}
        <div className="relative">
          <video
            ref={videoRef}
            src={src}
            preload="auto"
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPlaying={() => {
              setPlaying(true);
              setBuffering(false);
            }}
            onPause={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onStalled={() => setBuffering(true)}
            onSeeking={() => setBuffering(true)}
            onSeeked={() => {
              setBuffering(false);
              updateBuffered();
            }}
            onCanPlay={() => setBuffering(false)}
            onLoadStart={() => setBuffering(true)}
            onProgress={updateBuffered}
            onTimeUpdate={() => {
              onTimeUpdate();
              updateBuffered();
            }}
            onLoadedMetadata={applyDuration}
            onDurationChange={applyDuration}
            className={`mx-auto block w-full cursor-pointer bg-black ${
              sector ? "max-h-[34vh]" : "max-h-[46vh]"
            }`}
          />

          {buffering && !!src && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35">
              <span
                aria-label="Loading video"
                className="h-11 w-11 animate-spin rounded-full border-4 border-cream/25 border-t-mint"
              />
            </div>
          )}
        </div>

        {/* Custom, app-styled controls */}
        <div className="flex items-center gap-2 bg-[#160427] px-3 py-2.5 sm:gap-3">
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[16px] text-[#0b3d2c] shadow-[inset_0_0_0_2px_#b6ffe0,0_3px_0_0_#2a8b65] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#b6ffe0,0_1px_0_0_#2a8b65]"
            style={{ background: "linear-gradient(0deg, #37c491 0%, #5cffb6 100%)" }}
          >
            {playing ? "❚❚" : "▶"}
          </button>

          <span className="flex-none font-display text-[12px] font-bold tabular-nums text-cream/85">
            {fmt(rel)}
          </span>

          <div
            onPointerDown={onSeekBar}
            className="group relative h-3 flex-1 cursor-pointer overflow-hidden rounded-full bg-black/50 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)]"
          >
            {/* Grey "loaded so far" fill (buffered), behind the played fill. */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-cream/25"
              style={{ width: `${bufFrac * 100}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-mint"
              style={{ width: `${frac * 100}%` }}
            />
            <span
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream shadow-[0_1px_0_rgba(31,7,51,0.6),0_0_0_2px_rgba(31,7,51,0.4)]"
              style={{ left: `${frac * 100}%` }}
            />
          </div>

          <span className="flex-none font-display text-[12px] font-bold tabular-nums text-cream/45">
            {fmt(span)}
          </span>

          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[16px] text-cream shadow-[inset_0_0_0_2px_#8952dc,0_3px_0_0_rgba(17,0,69,0.4)] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#8952dc,0_1px_0_0_rgba(17,0,69,0.4)]"
            style={{ background: "rgba(37, 28, 92, 0.6)" }}
          >
            {muted ? "🔇" : "🔊"}
          </button>

          <button
            onClick={toggleFullscreen}
            aria-label="Fullscreen"
            className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[16px] text-cream shadow-[inset_0_0_0_2px_#8952dc,0_3px_0_0_rgba(17,0,69,0.4)] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#8952dc,0_1px_0_0_rgba(17,0,69,0.4)]"
            style={{ background: "rgba(37, 28, 92, 0.6)" }}
          >
            ⛶
          </button>
        </div>
      </div>
    );
  },
);
