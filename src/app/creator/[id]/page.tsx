"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatShareId } from "@/lib/share-id";

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
// One fixed colour per player seat (1-4), so a player reads the same everywhere.
const PLAYER_COLORS = ["#FF3D8B", "#FFD23F", "#27E1A1", "#38BDF8"];

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
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-violet-lift/50 text-[18px] shadow-[inset_0_0_0_2px_rgba(137,82,220,0.6)]">
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
      className={`inline-flex items-center gap-1 rounded-full bg-violet-deep/70 px-3 py-1 font-display text-[12px] font-bold tabular-nums text-cream/80 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.4)] ${className}`}
    >
      {children}
    </span>
  );
}

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

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
  // Click-to-place is always on: first click on the timeline sets a sector's
  // start, the second sets its end. `pendingStart` holds the first click.
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  // The player (1-4) newly-created sectors are assigned to. Chosen before
  // marking a sector so multi-player dubs can be laid out in one pass.
  const [activePlayer, setActivePlayer] = useState(1);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopAtRef = useRef<number | null>(null);

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

  // Draw the original audio waveform behind the timeline (best-effort; skipped
  // if the CDN blocks the fetch for decoding).
  const drawWave = useCallback(async (url: string) => {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new Ctx();
      const audio = await ac.decodeAudioData(buf);
      await ac.close();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = (canvas.width = canvas.clientWidth * 2);
      const H = (canvas.height = canvas.clientHeight * 2);
      const ctx = canvas.getContext("2d")!;
      const data = audio.getChannelData(0);
      const step = Math.floor(data.length / W);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,246,236,0.28)";
      for (let x = 0; x < W; x++) {
        let peak = 0;
        for (let i = 0; i < step; i++) peak = Math.max(peak, Math.abs(data[x * step + i] || 0));
        const h = Math.max(1, peak * H);
        ctx.fillRect(x, (H - h) / 2, 1, h);
      }
    } catch {
      /* waveform is optional */
    }
  }, []);

  useEffect(() => {
    if (upload?.sourceUrl) void drawWave(upload.sourceUrl);
  }, [upload?.sourceUrl, drawWave]);

  // Create a sector spanning two marked times, fitted so it can't overlap a
  // neighbour (start pushed past any sector it lands in; end clipped to the next
  // sector). Shared by the mouse click-to-place and the Ctrl shortcut.
  const commitSector = useCallback(
    (a: number, b: number) => {
      let start = Math.min(a, b);
      let end = Math.max(a, b);
      for (const s of segs) if (start >= s.startMs && start < s.endMs) start = s.endMs;
      const nextStart = segs
        .filter((s) => s.startMs >= start)
        .reduce((m, s) => Math.min(m, s.startMs), durMs);
      end = Math.min(end, nextStart);
      if (end <= start) {
        setMsg("No room for a sector there.");
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
    [segs, durMs, activePlayer],
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

    // Neighbours bound resizing so an edge can't overlap another sector.
    const others = segs.filter((s) => s.key !== seg.key);
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

  const addSeg = () => {
    const at = playhead || 0;
    const end = Math.min(durMs || at + 2000, at + 2000);
    setSegs((prev) => [
      ...prev,
      { key: uid(), startMs: Math.round(at), endMs: Math.round(end), label: "", transcript: "", emotionTag: "", player: activePlayer },
    ]);
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

  // Click an empty part of the timeline to mark a sector: first click sets the
  // start, second click sets the end. The playhead is left where it is — only
  // dragging the yellow knob moves it.
  const onTrackPlace = (e: React.PointerEvent) => {
    if (durMs <= 0) return;
    placePoint(timeAtClientX(e.clientX));
  };

  const deleteSeg = (key: string) => {
    setSegs((prev) => prev.filter((s) => s.key !== key));
  };

  const updateSel = (patch: Partial<Seg>) =>
    setSegs((prev) => prev.map((s) => (s.key === selected ? { ...s, ...patch } : s)));

  const save = async () => {
    setBusy("save");
    setMsg("");
    try {
      const r = await fetch("/api/creator/segments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id, durationMs: durMs, segments: segs }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Save failed.");
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy("");
    }
  };

  const ordered = [...segs].sort((a, b) => a.startMs - b.startMs);
  // The editor always shows a sector: the selected one if it still exists,
  // otherwise the first. This keeps the box static and defaulted to sector 1.
  const selKey = segs.some((s) => s.key === selected) ? selected : (ordered[0]?.key ?? "");
  const sel = segs.find((s) => s.key === selKey);
  const selIndex = ordered.findIndex((s) => s.key === selKey);
  const selColor = sel ? PLAYER_COLORS[(sel.player - 1) % 4] : "#fff";

  if (!upload) {
    return (
      <main className="g-screen">
        <p className="mt-20 text-cream/60">Loading…</p>
      </main>
    );
  }

  return (
    <main className="g-screen">
      <div className="flex h-[72px] items-center justify-between gap-4">
        <h1 className="g-logo">{upload.title || "Untitled"}</h1>
        {upload.shareId && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(upload.shareId!);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            title="Copy share code"
            className="flex items-center gap-2 rounded-[10px] border-2 border-violet-lift bg-violet-deep/60 px-3 py-2 text-cream transition hover:border-mint"
          >
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/50">
              Share code
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
          <SectionHead icon="🎬" title="Preview">
            <Badge>
              {fmt(playhead)} <span className="text-cream/40">/</span> {fmt(durMs)}
            </Badge>
          </SectionHead>
          <div
            ref={playerRef}
            className="g-player overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_2px_rgba(137,82,220,0.5)]"
          >
            <video
              ref={videoRef}
              src={upload.sourceUrl}
              preload="metadata"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={applyDuration}
              onDurationChange={applyDuration}
              className="mx-auto block max-h-[46vh] w-full cursor-pointer bg-black"
            />

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
                {fmt(playhead)}
              </span>

              {/* Seek / progress bar */}
              <div
                onPointerDown={onSeekBar}
                className="group relative h-3 flex-1 cursor-pointer rounded-full bg-black/50 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)]"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-mint"
                  style={{ width: `${durMs > 0 ? (playhead / durMs) * 100 : 0}%` }}
                />
                <span
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream shadow-[0_1px_0_rgba(31,7,51,0.6),0_0_0_2px_rgba(31,7,51,0.4)]"
                  style={{ left: `${durMs > 0 ? (playhead / durMs) * 100 : 0}%` }}
                />
              </div>

              <span className="flex-none font-display text-[12px] font-bold tabular-nums text-cream/45">
                {fmt(durMs)}
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
        </div>

        {/* Timeline */}
        <div className="g-panel">
          <SectionHead icon="🎞️" title="Timeline">
            <div className="flex items-center gap-2">
              <Badge className="text-mint">
                {segs.length} {segs.length === 1 ? "sector" : "sectors"}
              </Badge>
              {/* Active player (1-4): the seat any new sector is assigned to. */}
              <button
                type="button"
                onClick={() => setActivePlayer((p) => (p % 4) + 1)}
                title="Player the next sector is assigned to — click to change (1-4)"
                className="h-9 rounded-[9px] px-3 font-display text-[13px] font-black uppercase tracking-[0.04em] text-ink shadow-[inset_0_0_0_2px_rgba(255,255,255,0.55),0_3px_0_rgba(31,7,51,0.35)] transition-transform active:translate-y-[1px]"
                style={{ background: PLAYER_COLORS[(activePlayer - 1) % 4] }}
              >
                🎙 Player {activePlayer}
              </button>
              <button
                onClick={addSeg}
                className="g-btn g-btn-ghost h-9 px-4 text-[13px]"
                disabled={durMs <= 0}
              >
                + Add sector
              </button>
            </div>
          </SectionHead>

          {/* Framed track */}
          <div className="rounded-[12px] bg-violet-deep p-2 shadow-[inset_0_0_0_2px_#8952dc]">
            <div
              ref={trackRef}
              onPointerDown={onTrackPlace}
              className="relative h-[104px] w-full cursor-crosshair touch-none overflow-hidden rounded-[9px]"
              style={{
                background:
                  "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 44px), linear-gradient(180deg, #1c0733 0%, #2a0845 100%)",
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
                  <span className="absolute -left-[7px] -top-[4px] h-[15px] w-[15px] rotate-45 rounded-[3px] bg-sun shadow-[0_0_0_2px_rgba(31,7,51,0.5)]" />
                </div>
              )}
              {/* sectors */}
              {durMs > 0 &&
                ordered.map((s, i) => {
                  const left = (s.startMs / durMs) * 100;
                  const width = ((s.endMs - s.startMs) / durMs) * 100;
                  // Colour by player (1-4), so a player's sectors read the same
                  // everywhere — not a per-index rainbow.
                  const color = PLAYER_COLORS[(s.player - 1) % 4];
                  const isSel = s.key === selKey;
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
                      className="absolute top-2 bottom-2 z-10 flex cursor-grab items-center overflow-hidden rounded-[7px] active:cursor-grabbing"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.5)}%`,
                        background: color,
                        opacity: isSel ? 1 : 0.66,
                        boxShadow: isSel
                          ? "inset 0 0 0 2px rgba(255,255,255,0.95), inset 0 0 0 4px rgba(31,7,51,0.35), 0 3px 0 rgba(31,7,51,0.4)"
                          : "inset 0 0 0 2px rgba(255,255,255,0.35), 0 3px 0 rgba(31,7,51,0.3)",
                      }}
                      title={s.transcript || `Sector ${i + 1}`}
                    >
                      <span
                        onPointerDown={(e) => startDrag(e, s, "left")}
                        className="absolute left-0 top-0 bottom-0 z-20 flex w-3 cursor-ew-resize items-center justify-center bg-black/20 hover:bg-black/40"
                      >
                        <span className="h-5 w-[2px] rounded bg-white/70" />
                      </span>
                      <span className="pointer-events-none flex flex-1 items-center justify-center gap-1 truncate px-3 text-center font-display text-[13px] font-black text-ink [text-shadow:0_1px_0_rgba(255,255,255,0.4)]">
                        {i + 1}
                        <span className="rounded-full bg-[rgba(31,7,51,0.45)] px-1.5 text-[10px] leading-[15px] text-cream">
                          P{s.player}
                        </span>
                      </span>
                      <span
                        onPointerDown={(e) => startDrag(e, s, "right")}
                        className="absolute right-0 top-0 bottom-0 z-20 flex w-3 cursor-ew-resize items-center justify-center bg-black/20 hover:bg-black/40"
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
                  <span className="absolute -left-[5px] -top-[5px] h-[11px] w-[11px] rounded-full bg-magenta shadow-[0_0_0_2px_rgba(31,7,51,0.5)]" />
                </div>
              )}
            </div>
          </div>

          {/* Help / hint strip */}
          <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-violet-deep/50 px-3 py-2 text-[12px] leading-[1.5] text-cream/60 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.3)]">
            <span aria-hidden className="mt-[1px] text-[13px]">
              {pendingStart !== null ? "🎯" : "💡"}
            </span>
            {pendingStart !== null ? (
              <span className="text-magenta">
                Click the timeline again (or press{" "}
                <kbd className="font-display font-bold">Ctrl</kbd>) to set the sector end · Esc to
                cancel.
              </span>
            ) : (
              <span>
                Click the timeline to mark a sector start, then click again for its end · drag the{" "}
                <span className="text-sun">◆</span> playhead to scrub ·{" "}
                <kbd className="font-display font-bold text-cream/80">Space</kbd> play/pause ·{" "}
                <kbd className="font-display font-bold text-cream/80">←/→</kbd> jump 5s ·{" "}
                <kbd className="font-display font-bold text-cream/80">Ctrl</kbd> also marks a sector.
                Drag a sector to move it, its edges to resize;{" "}
                <kbd className="font-display font-bold text-cream/80">Delete</kbd> removes. Sectors
                can&apos;t overlap.
              </span>
            )}
          </div>
        </div>

        {/* Selected sector editor */}
        {sel ? (
          <div className="g-panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="rounded-[9px] px-3 py-1 font-display text-[14px] font-black uppercase tracking-[0.04em] text-ink shadow-[inset_0_0_0_2px_rgba(255,255,255,0.55),0_2px_0_rgba(31,7,51,0.35)]"
                  style={{ background: selColor }}
                >
                  Sector {selIndex + 1}
                </span>
                {/* Player assignment (1-4): click cycles which player dubs this sector. */}
                <button
                  type="button"
                  onClick={() => updateSel({ player: (sel.player % 4) + 1 })}
                  title="Which player dubs this sector — click to change (1-4)"
                  className="rounded-[9px] px-3 py-1 font-display text-[14px] font-black uppercase tracking-[0.04em] text-ink shadow-[inset_0_0_0_2px_rgba(255,255,255,0.55),0_2px_0_rgba(31,7,51,0.35)] transition-transform active:translate-y-[1px]"
                  style={{ background: PLAYER_COLORS[(sel.player - 1) % 4] }}
                >
                  🎙 Player {sel.player}
                </button>
                <Badge>
                  {fmt(sel.startMs)}–{fmt(sel.endMs)} · {((sel.endMs - sel.startMs) / 1000).toFixed(1)}s
                </Badge>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => playSeg(sel)}
                  className="g-btn g-btn-ghost h-9 px-4 text-[13px]"
                >
                  ▶ Play
                </button>
                <button
                  onClick={() => deleteSeg(sel.key)}
                  className="g-btn h-9 px-4 text-[13px] text-cream"
                  style={{
                    background: "linear-gradient(0deg, #d61f6c 0%, #ff3d8b 100%)",
                    boxShadow: "inset 0 0 0 2px #ffb0d2, 0 4px 0 0 #a4165a",
                  }}
                >
                  ✕ Delete
                </button>
              </div>
            </div>
            <label className="mb-1 block font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
              Replica line
            </label>
            <textarea
              value={sel.transcript}
              onChange={(e) => updateSel({ transcript: e.target.value })}
              placeholder="Type the line spoken in this sector…"
              rows={4}
              className="w-full rounded-[12px] bg-violet-deep/60 px-4 py-3 text-center font-display text-[20px] leading-[1.4] text-cream shadow-[inset_0_0_0_2px_rgba(137,82,220,0.4)] placeholder:text-cream/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            />
          </div>
        ) : (
          <div className="g-panel text-center">
            <p className="py-6 text-[14px] leading-[1.6] text-cream/55">
              No sectors yet. Move the playhead and press{" "}
              <span className="font-display font-bold text-cream">Add sector</span> (or{" "}
              <kbd className="font-display font-bold text-cream">Ctrl</kbd> on the timeline) to mark
              your first line.
            </p>
          </div>
        )}

        {/* Actions bar */}
        <div className="g-panel flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/creator"
            className="font-display text-[13px] font-bold text-cream/55 transition hover:text-cream"
          >
            ← Back to uploads
          </Link>
          <div className="flex items-center gap-3">
            {msg && (
              <span
                className={`font-display text-[13px] font-bold ${
                  msg === "Saved." ? "text-mint" : "text-magenta"
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
              {busy === "save" ? "Saving…" : "💾 Save sectors"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
