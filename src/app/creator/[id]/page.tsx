"use client";

import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { formatShareId } from "@/lib/share-id";
import { MAX_PLAYERS } from "@/lib/room-code";
import { useI18n } from "@/components/LanguageProvider";
import { AutoDetectProgress, type AutoState } from "@/components/AutoDetectProgress";

// i18n key for the auto-detect progress window, derived from the eased bar since
// the backend job only reports a coarse status. Translated at the call site.
function autoPhaseKeyFor(p: number): string {
  if (p < 0.3) return "editor.phase.listening";
  if (p < 0.62) return "editor.phase.transcribing";
  if (p < 0.95) return "editor.phase.placing";
  return "editor.phase.finishing";
}

type Seg = {
  key: string;
  startMs: number;
  endMs: number;
  label: string;
  transcript: string;
  emotionTag: string;
  player: number; // which player (1-4) dubs this sector
  partUrl?: string | null;
};
type Upload = {
  id: string;
  title: string;
  status: string;
  shareId: string | null;
  sourceUrl: string;
  durationMs: number;
  segments: {
    id: string;
    startMs: number;
    endMs: number;
    label: string;
    transcript: string;
    emotionTag: string;
    player?: number;
    partUrl?: string | null;
  }[];
};

const uid = () => Math.random().toString(36).slice(2);
const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
// One fixed colour per player seat, so a player reads the same everywhere.
const PLAYER_COLORS = ["#f7941d", "#FFD23F", "#38a8dc", "#38BDF8", "#7fc4e6", "#FB923C", "#F87171"];
const playerColor = (player: number) => PLAYER_COLORS[(player - 1) % PLAYER_COLORS.length];

// Timeline zoom: 1× fills the frame; higher values widen the track so it scrolls
// and sectors can be placed more precisely. A drag on the track past this many
// pixels is treated as a scroll (pan) rather than a tap that marks a sector — so
// scrolling is never mistaken for placing a sector start.
const ZOOM_STEPS = [1, 1.5, 2, 4, 8, 16];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const PAN_THRESHOLD = 6;

// A little sticker-icon + heading used atop each editor panel, in the app's
// chunky display style.
function SectionHead({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-violet-lift/50 text-[18px] shadow-[inset_0_0_0_2px_rgba(63,143,200,0.6)]">
          {icon}
        </span>
        <h2 className="font-display text-[15px] font-black uppercase tracking-[0.08em] text-cream">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

// Small rounded pill for counts / timecodes.
function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-violet-deep/70 px-3 py-1 font-display text-[12px] font-bold tabular-nums text-cream/80 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.4)] ${className}`}
    >
      {children}
    </span>
  );
}

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();

  // Touch/mobile devices get tap-drag instructions (and no keyboard hints).
  // We treat either a coarse pointer OR the narrow mobile layout (matching the
  // app's 860px breakpoint) as "mobile" so phones never get PC-only hints, even
  // if the browser misreports pointer type. SSR-safe: server snapshot is false,
  // the client subscribes to the media query.
  const MOBILE_MQ = "(pointer: coarse), (max-width: 860px)";
  const isTouch = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_MQ);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(MOBILE_MQ).matches,
    () => false,
  );

  const [upload, setUpload] = useState<Upload | null>(null);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [durMs, setDurMs] = useState(0);
  const [selected, setSelected] = useState<string>("");
  const [playhead, setPlayhead] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  // Loading state for the player: spinner while buffering, grey seek fill for
  // how much has downloaded so far.
  const [buffering, setBuffering] = useState(true);
  const [bufferedMs, setBufferedMs] = useState(0);
  // Editor readiness: the timeline, sector tools and buttons only work once the
  // clip's DURATION is known (durMs > 0) and the audio decode has finished. We
  // gate the whole editor on that so it never goes interactive while durMs is 0
  // (blank timeline, can't place sectors). durMs is set from whichever resolves
  // first — the video's metadata or the audio decode.
  const [waveDone, setWaveDone] = useState(false);
  // How far the timeline is zoomed in (1 = fit to frame). Above 1 the track
  // grows wider than its viewport and can be scrolled.
  const [zoom, setZoom] = useState(1);
  // Click-to-place is always on: first click on the timeline sets a sector's
  // start, the second sets its end. `pendingStart` holds the first click.
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  // The player (1-4) newly-created sectors are assigned to. Chosen before
  // marking a sector so multi-player dubs can be laid out in one pass.
  const [activePlayer, setActivePlayer] = useState(1);
  // How many distinct voices auto-detect should look for (diarization hint).
  // Most clips are a two-hander, so default to 2.
  const [speakers, setSpeakers] = useState(2);
  // Auto-detect progress window (the "downloading" pop-up, 0→100%).
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoProg, setAutoProg] = useState(0);
  const [autoPhase, setAutoPhase] = useState("");
  const [autoDetState, setAutoDetState] = useState<AutoState>("working");
  const [autoCount, setAutoCount] = useState(0);
  const [autoErr, setAutoErr] = useState("");
  const autoEaseRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null); // scroll viewport around the track
  const trackRef = useRef<HTMLDivElement>(null); // full-width (zoomed) inner track
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopAtRef = useRef<number | null>(null);
  // Decoded waveform samples, cached so re-rendering at a new zoom is cheap.
  const waveDataRef = useRef<Float32Array | null>(null);
  // In-flight track drag used to tell a scroll (pan) from a tap that marks a sector.
  const panRef = useRef<{ x: number; y: number; scroll: number; moved: boolean } | null>(null);

  // Load the upload + its segments.
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/creator/jobs");
      const d = (await r.json()) as { uploads: Upload[] };
      const u = d.uploads.find((x) => x.id === id) ?? null;
      setUpload(u);
      if (u) {
        setDurMs(u.durationMs || 0);
        setSegs(
          u.segments.map((s) => ({
            key: s.id,
            startMs: s.startMs,
            endMs: s.endMs,
            label: s.label,
            transcript: s.transcript,
            emotionTag: s.emotionTag,
            player: s.player ?? 1,
            partUrl: s.partUrl,
          })),
        );
      }
    })();
  }, [id]);

  // Paint the cached waveform onto the canvas at its current (zoomed) width.
  // Cheap enough to re-run whenever the track resizes.
  const renderWave = useCallback(() => {
    const canvas = canvasRef.current;
    const data = waveDataRef.current;
    if (!canvas || !data) return;
    const W = (canvas.width = Math.max(1, canvas.clientWidth * 2));
    const H = (canvas.height = Math.max(1, canvas.clientHeight * 2));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const step = Math.max(1, Math.floor(data.length / W));
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,246,236,0.28)";
    for (let x = 0; x < W; x++) {
      let peak = 0;
      for (let i = 0; i < step; i++) peak = Math.max(peak, Math.abs(data[x * step + i] || 0));
      const h = Math.max(1, peak * H);
      ctx.fillRect(x, (H - h) / 2, 1, h);
    }
  }, []);

  // Decode the original audio once, cache the samples, then draw. Best-effort;
  // skipped if the CDN blocks the fetch for decoding.
  const drawWave = useCallback(
    async (url: string) => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new Ctx();
        const audio = await ac.decodeAudioData(buf);
        await ac.close();
        waveDataRef.current = audio.getChannelData(0).slice();
        // The decoded audio also gives us a reliable duration — use it if the
        // video element hasn't reported one yet, so the editor can open.
        if (isFinite(audio.duration) && audio.duration > 0) {
          setDurMs((d) => (d > 0 ? d : Math.round(audio.duration * 1000)));
        }
        renderWave();
      } catch {
        /* waveform is optional — the editor still opens without it */
      } finally {
        setWaveDone(true);
      }
    },
    [renderWave],
  );

  useEffect(() => {
    if (upload?.sourceUrl) void drawWave(upload.sourceUrl);
    else if (upload) setWaveDone(true); // no audio to decode
  }, [upload, drawWave]);

  // Don't hang on a slow/optional waveform: after a grace period, grab the
  // duration straight off the video element (if it has one by now) and stop
  // waiting on the audio decode. Never opens the editor with durMs still 0.
  useEffect(() => {
    if (!upload) return;
    const t = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && isFinite(v.duration) && v.duration > 0) {
        setDurMs((d) => (d > 0 ? d : Math.round(v.duration * 1000)));
      }
      setWaveDone(true);
    }, 12000);
    return () => window.clearTimeout(t);
  }, [upload]);

  // Re-render the waveform crisply after the track width changes with the zoom.
  useEffect(() => {
    renderWave();
  }, [zoom, renderWave]);

  // Create a sector spanning two marked times, fitted so it can't overlap a
  // neighbour BELONGING TO THE SAME PLAYER (start pushed past any own sector it
  // lands in; end clipped to the next own sector). Different players may overlap
  // — they voice their lines at the same time in the final mix. Shared by the
  // mouse click-to-place and the Ctrl shortcut.
  const commitSector = useCallback(
    (a: number, b: number) => {
      let start = Math.min(a, b);
      let end = Math.max(a, b);
      const mine = segs.filter((s) => s.player === activePlayer);
      for (const s of mine) if (start >= s.startMs && start < s.endMs) start = s.endMs;
      const nextStart = mine
        .filter((s) => s.startMs >= start)
        .reduce((m, s) => Math.min(m, s.startMs), durMs);
      end = Math.min(end, nextStart);
      if (end <= start) {
        setMsg(t("editor.noRoom", { n: activePlayer }));
        return;
      }
      const key = uid();
      setSegs((prev) => [
        ...prev,
        {
          key,
          startMs: Math.round(start),
          endMs: Math.round(end),
          label: "",
          transcript: "",
          emotionTag: "",
          player: activePlayer,
        },
      ]);
      setSelected(key);
    },
    [segs, durMs, activePlayer, t],
  );

  // Drop a sector mark at `at`: the first mark sets the start, the second
  // completes the sector.
  const placePoint = useCallback(
    (at: number) => {
      if (pendingStart === null) {
        setPendingStart(at);
        return;
      }
      commitSector(pendingStart, at);
      setPendingStart(null);
    },
    [pendingStart, commitSector],
  );

  // Keyboard control of the selected sector: Delete / Backspace removes it,
  // Left / Right arrows move the selection to the previous / next sector.
  // Ignored while typing in a field or scrubbing the video.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "VIDEO" ||
          t.isContentEditable)
      )
        return;

      if (e.key === "Escape") {
        setPendingStart(null);
        return;
      }

      // Space toggles play / pause of the video.
      if (e.code === "Space" || e.key === " ") {
        const v = videoRef.current;
        if (!v) return;
        e.preventDefault();
        if (v.paused) {
          stopAtRef.current = null; // play freely, not just a sector preview
          void v.play().catch(() => {});
        } else {
          v.pause();
        }
        return;
      }

      // Ctrl drops a sector mark at the current playhead: first press sets the
      // start, the second creates the sector (same as clicking the timeline).
      if (e.key === "Control" && !e.repeat) {
        const v = videoRef.current;
        if (!v || durMs <= 0) return;
        e.preventDefault();
        placePoint(Math.round(v.currentTime * 1000));
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setSegs((prev) => prev.filter((s) => s.key !== selected));
        return;
      }

      // Left / Right seek the video by 5 seconds.
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const v = videoRef.current;
        if (!v) return;
        e.preventDefault();
        stopAtRef.current = null;
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const max = durMs > 0 ? durMs / 1000 : isFinite(v.duration) ? v.duration : Infinity;
        v.currentTime = Math.max(0, Math.min(max, v.currentTime + dir * 5));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, segs, durMs, pendingStart, activePlayer, placePoint]);

  // Playhead + stop-at-end while a sector previews.
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setPlayhead(v.currentTime * 1000);
    if (stopAtRef.current != null && v.currentTime * 1000 >= stopAtRef.current) {
      v.pause();
      stopAtRef.current = null;
    }
    // Keep the playhead within view while playing when zoomed in.
    const vp = scrollRef.current;
    if (vp && zoom > 1 && durMs > 0) {
      const px = ((v.currentTime * 1000) / durMs) * vp.clientWidth * zoom;
      const margin = vp.clientWidth * 0.12;
      if (px < vp.scrollLeft + margin) vp.scrollLeft = px - margin;
      else if (px > vp.scrollLeft + vp.clientWidth - margin)
        vp.scrollLeft = px - vp.clientWidth + margin;
    }
  };

  // --- custom video player controls -----------------------------------------
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      stopAtRef.current = null; // free play, not just a sector preview
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

  const seekFrac = (frac: number) => {
    const v = videoRef.current;
    if (!v || durMs <= 0) return;
    stopAtRef.current = null;
    const t = Math.min(1, Math.max(0, frac)) * durMs;
    v.currentTime = t / 1000;
    setPlayhead(t);
  };

  // Click / drag the player's own progress bar to scrub.
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

  // Resolve the video duration. Streamed / fragmented CDN files often report
  // `Infinity` on the first load (fixed only after the file is fully cached — a
  // page reload). When that happens, seek far past the end to force the browser
  // to compute the real duration, which then arrives via `durationchange`.
  const seekedForDurRef = useRef(false);
  // Track the downloaded range covering the current position (grey seek fill).
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
    if (!v) return;
    if (isFinite(v.duration) && v.duration > 0) {
      setDurMs(Math.round(v.duration * 1000));
      if (seekedForDurRef.current) {
        seekedForDurRef.current = false;
        try {
          v.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
    } else if (v.duration === Infinity && !seekedForDurRef.current) {
      seekedForDurRef.current = true;
      try {
        v.currentTime = 1e7;
      } catch {
        /* ignore */
      }
    }
  };

  const playSeg = (s: Seg) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = s.startMs / 1000;
    stopAtRef.current = s.endMs;
    void v.play();
  };

  // Drag a sector (move / resize left / resize right) on the timeline.
  const startDrag = (e: React.PointerEvent, seg: Seg, mode: "move" | "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(seg.key);
    const track = trackRef.current;
    if (!track || durMs <= 0) return;
    const width = track.getBoundingClientRect().width;
    const startX = e.clientX;
    const { startMs: os, endMs: oe } = seg;

    // Only same-player neighbours bound resizing/moving — a sector may overlap
    // sectors owned by other players (simultaneous lines in the final mix).
    const others = segs.filter((s) => s.key !== seg.key && s.player === seg.player);
    const prevEnd = others.filter((s) => s.endMs <= os).reduce((m, s) => Math.max(m, s.endMs), 0);
    const nextStart = others
      .filter((s) => s.startMs >= oe)
      .reduce((m, s) => Math.min(m, s.startMs), durMs);
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

    // For moving: the free gaps between the other sectors, and the start
    // positions where this sector (length `len`) fits. Dragging past a sector
    // by half its dead-zone snaps the sector to the far side (jump-over); gaps
    // too small to hold it are skipped, so it only jumps where there's room.
    const len = oe - os;
    const obstacles = [...others].sort((a, b) => a.startMs - b.startMs);
    const gaps: [number, number][] = [];
    let c = 0;
    for (const o of obstacles) {
      if (o.startMs > c) gaps.push([c, o.startMs]);
      c = Math.max(c, o.endMs);
    }
    if (durMs > c) gaps.push([c, durMs]);
    const slots = gaps.filter(([a, b]) => b - a >= len).map(([a, b]) => [a, b - len] as const);
    const snapStart = (x: number) => {
      const xc = clamp(x, 0, durMs - len);
      for (const [a, b] of slots) if (xc >= a && xc <= b) return xc; // inside a slot → follow cursor
      let best = xc;
      let bestDist = Infinity;
      for (const [a, b] of slots) {
        for (const edge of [a, b]) {
          const d = Math.abs(xc - edge);
          if (d < bestDist) {
            bestDist = d;
            best = edge;
          }
        }
      }
      return best; // nearest reachable slot edge
    };

    const move = (ev: PointerEvent) => {
      const dms = ((ev.clientX - startX) / width) * durMs;
      setSegs((prev) =>
        prev.map((s) => {
          if (s.key !== seg.key) return s;
          let start = os;
          let end = oe;
          if (mode === "move") {
            start = snapStart(os + dms);
            end = start + len;
          } else if (mode === "left") {
            start = clamp(os + dms, prevEnd, oe);
          } else {
            end = clamp(oe + dms, os, nextStart);
          }
          return { ...s, startMs: Math.round(start), endMs: Math.round(end) };
        }),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Time (ms) at a click x-position on the track.
  const timeAtClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || durMs <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(frac * durMs);
  };

  // Drag the yellow playhead knob to scrub the video. stopPropagation keeps a
  // grab on the knob from also dropping a sector mark on the track underneath.
  const startPlayheadDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (durMs <= 0) return;
    const v = videoRef.current;
    if (!v) return;
    stopAtRef.current = null;
    const seek = (clientX: number) => {
      const t = timeAtClientX(clientX);
      v.currentTime = t / 1000;
      setPlayhead(t);
    };
    seek(e.clientX);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Change the zoom while keeping whatever is under the viewport centre put, so
  // zooming in/out feels anchored rather than jumping back to the start.
  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(1, Math.round(next * 2) / 2));
    setZoom((prev) => {
      const vp = scrollRef.current;
      if (vp && vp.clientWidth > 0 && clamped !== prev) {
        const frac = (vp.scrollLeft + vp.clientWidth / 2) / (vp.clientWidth * prev);
        const nextScroll = frac * vp.clientWidth * clamped - vp.clientWidth / 2;
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollLeft = Math.max(0, nextScroll);
        });
      }
      return clamped;
    });
  }, []);

  // Step to the next preset zoom (1× → 1.5× → 2× → 4× → back to 1×).
  const cycleZoom = useCallback(() => {
    const i = ZOOM_STEPS.indexOf(zoom);
    applyZoom(ZOOM_STEPS[(i + 1) % ZOOM_STEPS.length] ?? 1);
  }, [zoom, applyZoom]);

  // Pointer down on an empty part of the track. We don't act yet: a stationary
  // release marks a sector (first tap = start, second = end), while a drag past
  // PAN_THRESHOLD scrolls the timeline instead — so a scroll is never mistaken
  // for placing a sector start. Sector/handle/playhead drags stopPropagation, so
  // they never reach here.
  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (durMs <= 0) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const vp = scrollRef.current;
    panRef.current = { x: e.clientX, y: e.clientY, scroll: vp ? vp.scrollLeft : 0, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onTrackPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (!p.moved && Math.hypot(dx, e.clientY - p.y) > PAN_THRESHOLD) p.moved = true;
    if (p.moved) {
      const vp = scrollRef.current;
      if (vp) vp.scrollLeft = p.scroll - dx;
    }
  };

  const onTrackPointerUp = (e: React.PointerEvent) => {
    const p = panRef.current;
    panRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!p || p.moved) return; // a scroll, not a tap — don't mark a sector
    placePoint(timeAtClientX(e.clientX));
  };

  const deleteSeg = (key: string) => {
    setSegs((prev) => prev.filter((s) => s.key !== key));
  };

  const updateSel = (patch: Partial<Seg>) =>
    setSegs((prev) => {
      // Target the sector the panel is actually showing: the explicitly-selected
      // one, or (when nothing is selected, e.g. right after auto-detect) the
      // first sector — same fallback the render uses for `selKey`.
      const key = prev.some((s) => s.key === selected)
        ? selected
        : [...prev].sort((a, b) => a.startMs - b.startMs)[0]?.key;
      return prev.map((s) => (s.key === key ? { ...s, ...patch } : s));
    });

  const save = async () => {
    setBusy("save");
    setMsg("");
    try {
      const r = await fetch("/api/creator/segments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id, durationMs: durMs, segments: segs }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("editor.saveFailed"));
      setMsg(t("editor.saved"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("editor.saveFailed"));
    } finally {
      setBusy("");
    }
  };

  // AI auto-detect: transcribe the audio and let Claude build the sectors,
  // replacing whatever's on the timeline. Runs in the background, so we kick it
  // off then poll until it's ready and load the detected sectors. The creator
  // can then tweak and save as usual.
  const stopAutoEase = () => {
    if (autoEaseRef.current) {
      window.clearInterval(autoEaseRef.current);
      autoEaseRef.current = null;
    }
  };

  const autoDetect = async () => {
    setBusy("auto");
    setMsg("");
    // Pop the progress window and start easing the bar toward ~95% (the backend
    // job only reports processing → ready, so there's no true % to read).
    setAutoErr("");
    setAutoCount(0);
    setAutoDetState("working");
    setAutoProg(0);
    setAutoPhase(t(autoPhaseKeyFor(0)));
    setAutoOpen(true);
    const startedAt = Date.now();
    stopAutoEase();
    autoEaseRef.current = window.setInterval(() => {
      const el = (Date.now() - startedAt) / 1000;
      const p = Math.min(0.95, 0.04 + 0.91 * (1 - Math.exp(-el / 22)));
      setAutoProg(p);
      setAutoPhase(t(autoPhaseKeyFor(p)));
    }, 120);

    try {
      const start = await fetch("/api/creator/autosector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id, speakersExpected: speakers }),
      });
      if (!start.ok) throw new Error((await start.json()).error || t("editor.autoFailed"));

      // Poll for completion (up to ~10 min for long clips).
      const deadline = Date.now() + 10 * 60_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await fetch(`/api/creator/autosector?uploadId=${id}`);
        const d = (await r.json()) as {
          status?: string;
          error?: string;
          segments?: Upload["segments"];
        };
        if (!r.ok) throw new Error(d.error || t("editor.autoFailed"));
        if (d.status === "error") throw new Error(d.error || t("editor.autoFailed"));
        if (d.status === "ready") {
          const detected = d.segments ?? [];
          setSegs(
            detected.map((s) => ({
              key: s.id,
              startMs: s.startMs,
              endMs: s.endMs,
              label: s.label,
              transcript: s.transcript,
              emotionTag: s.emotionTag,
              player: s.player ?? 1,
              partUrl: s.partUrl,
            })),
          );
          // Snap the window to 100% and switch it to the "done" state.
          stopAutoEase();
          setAutoProg(1);
          setAutoCount(detected.length);
          setAutoDetState("done");
          setMsg(detected.length ? t("editor.detected", { n: detected.length }) : t("editor.noSpeech"));
          break;
        }
        if (Date.now() > deadline) throw new Error(t("editor.autoTimeout"));
      }
    } catch (e) {
      stopAutoEase();
      setAutoDetState("error");
      setAutoErr(e instanceof Error ? e.message : t("editor.autoFailed"));
      setMsg(e instanceof Error ? e.message : t("editor.autoFailed"));
    } finally {
      setBusy("");
    }
  };

  // Stop the easing timer if the editor unmounts mid-detect.
  useEffect(() => stopAutoEase, []);

  const ordered = [...segs].sort((a, b) => a.startMs - b.startMs);
  // Lane layout: overlapping (different-player) sectors are stacked into vertical
  // lanes so each stays visible and draggable. Greedy first-fit over the
  // start-sorted sectors — with no overlaps everything lands in lane 0 and the
  // track looks exactly as before.
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const s of ordered) {
    let lane = laneEnds.findIndex((end) => end <= s.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endMs);
    } else {
      laneEnds[lane] = s.endMs;
    }
    laneOf.set(s.key, lane);
  }
  const laneCount = Math.max(1, laneEnds.length);
  // The editor always shows a sector: the selected one if it still exists,
  // otherwise the first. This keeps the box static and defaulted to sector 1.
  const selKey = segs.some((s) => s.key === selected) ? selected : (ordered[0]?.key ?? "");
  const sel = segs.find((s) => s.key === selKey);

  if (!upload) {
    return (
      <main className="g-screen">
        <p className="mt-20 text-cream/60">{t("editor.loading")}</p>
      </main>
    );
  }

  // The editor is only interactive once the duration is known (durMs > 0) and
  // the audio decode has finished — until then a full-screen loader covers it
  // (the video still loads underneath), so there's never a window where the
  // timeline is blank or the sector tools/buttons silently do nothing.
  const ready = durMs > 0 && waveDone;

  return (
    <main className="g-screen">
      {/* Step-by-step loader — video first, then the audio/timeline. The editor
          renders underneath (so the <video> loads) but is covered until ready. */}
      {!ready && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-violet-deep/95">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-cream/20 border-t-mint" />
          <div className="text-center">
            <p className="font-display text-[17px] font-black text-cream">
              {durMs <= 0 ? t("editor.loadingVideo") : t("editor.readingAudio")}
            </p>
            <p className="mt-1 text-[13px] text-cream/50">{t("editor.gettingReady")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em]">
              <span className={`h-2 w-2 rounded-full ${durMs > 0 ? "bg-mint" : "bg-cream/25"}`} />
              <span className={durMs > 0 ? "text-mint" : "text-cream/40"}>{t("editor.video")}</span>
            </span>
            <span className="h-px w-6 bg-cream/20" />
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em]">
              <span className={`h-2 w-2 rounded-full ${waveDone ? "bg-mint" : "bg-cream/25"}`} />
              <span className={waveDone ? "text-mint" : "text-cream/40"}>{t("editor.audio")}</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex h-[72px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/creator"
            title={t("editor.backToVideos")}
            className="grid h-10 w-10 flex-none place-items-center rounded-[10px] border-2 border-violet-lift bg-violet-deep/60 text-[18px] text-cream transition hover:border-mint"
          >
            ←
          </Link>
          <h1 className="g-logo truncate">{upload.title || t("lib.untitled")}</h1>
        </div>
        {upload.shareId && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(upload.shareId!);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            title={t("creator.copyShare")}
            className="flex items-center gap-2 rounded-[10px] border-2 border-violet-lift bg-violet-deep/60 px-3 py-2 text-cream transition hover:border-mint"
          >
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/50">
              {t("editor.shareCode")}
            </span>
            <span className="font-display text-[16px] font-black tracking-[0.12em] text-mint tnum">
              {formatShareId(upload.shareId)}
            </span>
            <span aria-hidden className="text-[13px] text-cream/60">
              {copied ? "✓" : "⧉"}
            </span>
          </button>
        )}
      </div>

      <div className="flex w-full max-w-4xl flex-col gap-4">
        {/* Video preview */}
        <div className="g-panel">
          <SectionHead icon="🎬" title={t("editor.preview")}>
            <Badge>
              {fmt(playhead)} <span className="text-cream/40">/</span> {fmt(durMs)}
            </Badge>
          </SectionHead>
          <div
            ref={playerRef}
            className="g-player overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_2px_rgba(63,143,200,0.5)]"
          >
            <div className="relative">
              <video
                ref={videoRef}
                src={upload.sourceUrl}
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
                onError={() => setWaveDone(true)}
                className="mx-auto block max-h-[46vh] w-full cursor-pointer bg-black"
              />

              {buffering && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35">
                  <span
                    aria-label={t("editor.loadingVideoAria")}
                    className="h-11 w-11 animate-spin rounded-full border-4 border-cream/25 border-t-mint"
                  />
                </div>
              )}
            </div>

            {/* Custom, app-styled controls */}
            <div className="flex items-center gap-2 bg-[#071e2c] px-3 py-2.5 sm:gap-3">
              <button
                onClick={togglePlay}
                aria-label={playing ? t("editor.pause") : t("editor.play")}
                className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[16px] text-[#0c3348] shadow-[inset_0_0_0_2px_#bfe8fb,0_3px_0_0_#1f6b93] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#bfe8fb,0_1px_0_0_#1f6b93]"
                style={{ background: "linear-gradient(0deg, #2f92c8 0%, #4fb8e6 100%)" }}
              >
                {playing ? "❚❚" : "▶"}
              </button>

              <span className="flex-none font-display text-[12px] font-bold tabular-nums text-cream/85">
                {fmt(playhead)}
              </span>

              {/* Seek / progress bar */}
              <div
                onPointerDown={onSeekBar}
                className="group relative h-3 flex-1 cursor-pointer overflow-hidden rounded-full bg-black/50 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)]"
              >
                {/* Grey "loaded so far" fill (buffered), behind the played fill. */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-cream/25"
                  style={{ width: `${durMs > 0 ? Math.min(100, (bufferedMs / durMs) * 100) : 0}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-mint"
                  style={{ width: `${durMs > 0 ? (playhead / durMs) * 100 : 0}%` }}
                />
                <span
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream shadow-[0_1px_0_rgba(8,34,48,0.6),0_0_0_2px_rgba(8,34,48,0.4)]"
                  style={{ left: `${durMs > 0 ? (playhead / durMs) * 100 : 0}%` }}
                />
              </div>

              <span className="flex-none font-display text-[12px] font-bold tabular-nums text-cream/45">
                {fmt(durMs)}
              </span>

              <button
                onClick={toggleMute}
                aria-label={muted ? t("editor.unmute") : t("editor.mute")}
                className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[16px] text-cream shadow-[inset_0_0_0_2px_#3f8fc8,0_3px_0_0_rgba(8,34,48,0.4)] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#3f8fc8,0_1px_0_0_rgba(8,34,48,0.4)]"
                style={{ background: "rgba(16, 57, 79, 0.6)" }}
              >
                {muted ? "🔇" : "🔊"}
              </button>

              <button
                onClick={toggleFullscreen}
                aria-label={t("editor.fullscreen")}
                className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[16px] text-cream shadow-[inset_0_0_0_2px_#3f8fc8,0_3px_0_0_rgba(8,34,48,0.4)] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#3f8fc8,0_1px_0_0_rgba(8,34,48,0.4)]"
                style={{ background: "rgba(16, 57, 79, 0.6)" }}
              >
                ⛶
              </button>
            </div>
          </div>
        </div>

        {/* The selected sector's line, sitting between the video and the
            timeline. Editable so you can fix what the AI transcribed. */}
        {sel && (
          <textarea
            value={sel.transcript}
            onChange={(e) => updateSel({ transcript: e.target.value })}
            placeholder={t("editor.linePlaceholder")}
            rows={2}
            className="w-full resize-none rounded-[12px] bg-violet-deep/60 px-4 py-3 text-center font-display text-[20px] leading-[1.4] text-cream shadow-[inset_0_0_0_2px_rgba(63,143,200,0.4)] placeholder:text-cream/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
          />
        )}

        {/* Timeline */}
        <div className="g-panel">
          <SectionHead icon="🎞️" title={t("editor.timeline")}>
            <div className="flex flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
              {/* Zoom: one button cycling fixed steps (1× → 1.5× → 2× → 4×). */}
              <button
                type="button"
                onClick={cycleZoom}
                disabled={durMs <= 0}
                title={t("editor.zoomTitle")}
                aria-label={t("editor.zoomAria", { zoom })}
                className="h-9 flex-none rounded-[9px] px-2.5 font-display text-[13px] font-black tabular-nums text-cream shadow-[inset_0_0_0_2px_#3f8fc8,0_3px_0_0_rgba(8,34,48,0.4)] transition-transform active:translate-y-[1px] disabled:opacity-35 sm:px-3"
                style={{ background: "rgba(16, 57, 79, 0.6)" }}
              >
                🔍 {zoom % 1 === 0 ? zoom : zoom.toFixed(1)}×
              </button>
              {/* Sector count — hidden on phones so the buttons stay on one row. */}
              <Badge className="hidden text-mint sm:inline-flex">
                {segs.length} {segs.length === 1 ? t("editor.sector") : t("editor.sectors")}
              </Badge>
              {/* Player of the SELECTED sector — click cycles which player dubs
                  it (and becomes the default for the next new sector). */}
              <button
                type="button"
                onClick={() => {
                  const base = sel?.player ?? activePlayer;
                  const np = (base % MAX_PLAYERS) + 1;
                  if (sel) updateSel({ player: np });
                  setActivePlayer(np);
                }}
                title={t("editor.whichPlayer")}
                className="h-9 flex-none rounded-[9px] px-2.5 font-display text-[13px] font-black uppercase tracking-[0.04em] text-ink shadow-[inset_0_0_0_2px_rgba(255,255,255,0.55),0_3px_0_rgba(8,34,48,0.35)] transition-transform active:translate-y-[1px] sm:px-3"
                style={{ background: playerColor(sel?.player ?? activePlayer) }}
              >
                🎙 <span className="sm:hidden">P{sel?.player ?? activePlayer}</span>
                <span className="hidden sm:inline">{t("creator.playerN", { n: sel?.player ?? activePlayer })}</span>
              </button>
              {/* Expected number of speakers for auto-detect — click to cycle
                  1..MAX_PLAYERS. Hints the diarizer so it separates the voices. */}
              <button
                type="button"
                onClick={() => setSpeakers((n) => (n % MAX_PLAYERS) + 1)}
                disabled={durMs <= 0 || busy === "auto"}
                title={t("editor.speakersTitle")}
                className="h-9 flex-none rounded-[9px] px-2.5 font-display text-[13px] font-black tabular-nums text-cream shadow-[inset_0_0_0_2px_#3f8fc8,0_3px_0_0_rgba(8,34,48,0.4)] transition-transform active:translate-y-[1px] disabled:opacity-35 sm:px-3"
                style={{ background: "rgba(16, 57, 79, 0.6)" }}
              >
                👥 {speakers}
              </button>
              <button
                onClick={autoDetect}
                className="g-btn g-btn-ghost h-9 flex-none px-3 text-[13px] sm:px-4"
                disabled={durMs <= 0 || busy === "auto"}
                title={t("editor.autoTitle")}
              >
                {busy === "auto" ? `🪄 ${t("editor.detecting")}` : (
                  <>
                    🪄 {t("editor.auto")}<span className="hidden sm:inline">{t("editor.autoSuffix")}</span>
                  </>
                )}
              </button>
              <button
                onClick={() => sel && deleteSeg(sel.key)}
                disabled={!sel}
                title={t("editor.deleteSectorTitle")}
                className="g-btn h-9 flex-none px-3 text-[13px] text-cream disabled:opacity-35 sm:px-4"
                style={{
                  background: "linear-gradient(0deg, #d17a0f 0%, #f7941d 100%)",
                  boxShadow: "inset 0 0 0 2px #ffd0a0, 0 4px 0 0 #9a5410",
                }}
              >
                ✕ {t("editor.delete")}<span className="hidden sm:inline">{t("editor.sectorSuffix")}</span>
              </button>
            </div>
          </SectionHead>

          {/* Framed track — a scroll viewport wraps the (zoomable) inner track */}
          <div className="rounded-[12px] bg-violet-deep p-2 shadow-[inset_0_0_0_2px_#3f8fc8]">
            <div ref={scrollRef} className="g-timeline-scroll relative overflow-x-auto overflow-y-hidden rounded-[9px]">
            <div
              ref={trackRef}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerUp}
              onPointerCancel={() => {
                panRef.current = null;
              }}
              className="relative h-[104px] cursor-crosshair touch-none rounded-[9px]"
              style={{
                width: `${zoom * 100}%`,
                background:
                  "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 44px), linear-gradient(180deg, #0a2233 0%, #0c2e42 100%)",
              }}
            >
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
              {/* playhead + knob */}
              {durMs > 0 && (
                <div
                  onPointerDown={startPlayheadDrag}
                  className="absolute top-0 bottom-0 z-40 w-[2px] cursor-ew-resize touch-none bg-sun"
                  style={{ left: `${(playhead / durMs) * 100}%` }}
                >
                  {/* Wider transparent grab zone so the thin line is easy to catch. */}
                  <span className="absolute -left-[9px] top-0 bottom-0 w-[20px]" />
                  <span className="absolute -left-[7px] -top-[4px] h-[15px] w-[15px] rotate-45 rounded-[3px] bg-sun shadow-[0_0_0_2px_rgba(8,34,48,0.5)]" />
                </div>
              )}
              {/* sectors */}
              {durMs > 0 &&
                ordered.map((s, i) => {
                  const left = (s.startMs / durMs) * 100;
                  const width = ((s.endMs - s.startMs) / durMs) * 100;
                  // Colour by player, so a player's sectors read the same
                  // everywhere — not a per-index rainbow.
                  const color = playerColor(s.player);
                  const isSel = s.key === selKey;
                  // Vertical lane so overlapping sectors don't hide each other.
                  // TRACK_H matches the track's h-[104px]; PAD mirrors the old
                  // top-2/bottom-2 (8px) so a single lane looks identical.
                  const TRACK_H = 104;
                  const PAD = 8;
                  const GAP = 3;
                  const laneH = (TRACK_H - PAD * 2 - (laneCount - 1) * GAP) / laneCount;
                  const top = PAD + (laneOf.get(s.key) ?? 0) * (laneH + GAP);
                  return (
                    <div
                      key={s.key}
                      onPointerDown={(e) => startDrag(e, s, "move")}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Clicking a sector cancels a pending placement.
                        setPendingStart(null);
                        setSelected(s.key);
                        playSeg(s);
                      }}
                      className="absolute z-10 flex touch-none cursor-grab items-center overflow-hidden rounded-[7px] active:cursor-grabbing"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.5)}%`,
                        top: `${top}px`,
                        height: `${laneH}px`,
                        background: color,
                        opacity: isSel ? 1 : 0.66,
                        boxShadow: isSel
                          ? "inset 0 0 0 2px rgba(255,255,255,0.95), inset 0 0 0 4px rgba(8,34,48,0.35), 0 3px 0 rgba(8,34,48,0.4)"
                          : "inset 0 0 0 2px rgba(255,255,255,0.35), 0 3px 0 rgba(8,34,48,0.3)",
                        zIndex: isSel ? 20 : 10,
                      }}
                      title={s.transcript || t("editor.sectorN", { n: i + 1 })}
                    >
                      <span
                        onPointerDown={(e) => startDrag(e, s, "left")}
                        className="absolute left-0 top-0 bottom-0 z-20 flex w-5 touch-none cursor-ew-resize items-center justify-center bg-black/20 hover:bg-black/40"
                      >
                        <span className="h-5 w-[2px] rounded bg-white/70" />
                      </span>
                      <span className="pointer-events-none flex flex-1 items-center justify-center gap-1 truncate px-3 text-center font-display text-[13px] font-black text-ink [text-shadow:0_1px_0_rgba(255,255,255,0.4)]">
                        {i + 1}
                        <span className="rounded-full bg-[rgba(8,34,48,0.45)] px-1.5 text-[10px] leading-[15px] text-cream">
                          P{s.player}
                        </span>
                      </span>
                      <span
                        onPointerDown={(e) => startDrag(e, s, "right")}
                        className="absolute right-0 top-0 bottom-0 z-20 flex w-5 touch-none cursor-ew-resize items-center justify-center bg-black/20 hover:bg-black/40"
                      >
                        <span className="h-5 w-[2px] rounded bg-white/70" />
                      </span>
                    </div>
                  );
                })}

              {/* Pending start marker (after the first click). */}
              {pendingStart !== null && durMs > 0 && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-30 w-[2px] bg-magenta"
                  style={{ left: `${(pendingStart / durMs) * 100}%` }}
                >
                  <span className="absolute -left-[5px] -top-[5px] h-[11px] w-[11px] rounded-full bg-magenta shadow-[0_0_0_2px_rgba(8,34,48,0.5)]" />
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Help / hint strip */}
          <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-violet-deep/50 px-3 py-2 text-[12px] leading-[1.5] text-cream/60 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.3)]">
            <span aria-hidden className="mt-[1px] text-[13px]">
              {pendingStart !== null ? "🎯" : "💡"}
            </span>
            {pendingStart !== null ? (
              <span className="text-magenta">
                {isTouch ? t("editor.helpPending.touch") : t("editor.helpPending.pc")}
              </span>
            ) : isTouch ? (
              <span>{t("editor.help.touch")}</span>
            ) : (
              <span>{t("editor.help.pc")}</span>
            )}
          </div>
        </div>

        {/* Actions bar */}
        <div className="g-panel flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/creator"
            className="font-display text-[13px] font-bold text-cream/55 transition hover:text-cream"
          >
            ← {t("editor.backToUploads")}
          </Link>
          <div className="flex items-center gap-3">
            {msg && (
              <span
                className={`font-display text-[13px] font-bold ${
                  msg === t("editor.saved") ? "text-mint" : "text-magenta"
                }`}
              >
                {msg}
              </span>
            )}
            <button
              onClick={save}
              disabled={!!busy}
              className="g-btn g-btn-primary h-12 px-7 text-[16px] disabled:opacity-60"
            >
              {busy === "save" ? t("common.saving") : `💾 ${t("editor.saveSectors")}`}
            </button>
          </div>
        </div>
      </div>
      <AutoDetectProgress
        open={autoOpen}
        progress={autoProg}
        phase={autoPhase}
        state={autoDetState}
        count={autoCount}
        error={autoErr}
        onClose={() => setAutoOpen(false)}
      />
    </main>
  );
}
