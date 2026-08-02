"use client";

import { useEffect, useRef } from "react";

// Draws waveforms exactly like the editor's timeline waveform: one vertical
// 1px bar per canvas column, peak-amplitude tall, centered. The original sector
// sits underneath in blue; the player's voice is overlaid in red — drawn live
// from the left edge as you record (one column per frame), then the recorded
// take's full waveform after. The live loop reads `getLevel()` each frame so it
// animates without forcing a React re-render.

const ORIG_COLOR = "rgba(56,189,248,0.7)"; // blue
const MINE_COLOR = "rgba(255,60,60,0.5)"; // semitransparent red (voice)

// Editor-style dense waveform: rescale `data` across the full width.
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  data: Float32Array,
  color: string,
) {
  const step = Math.max(1, Math.floor(data.length / W));
  ctx.fillStyle = color;
  for (let x = 0; x < W; x++) {
    let peak = 0;
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i];
      if (v) peak = Math.max(peak, Math.abs(v));
    }
    const h = Math.max(1, peak * H);
    ctx.fillRect(x, (H - h) / 2, 1, h);
  }
}

export function RecorderWave({
  original,
  take,
  recording,
  getLevel,
  durationMs,
}: {
  original?: Float32Array;
  take?: Float32Array;
  recording: boolean;
  getLevel: () => number;
  durationMs?: number; // sector length: the red reaches the far edge at this time
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufRef = useRef<Float32Array | null>(null);
  const bufOrigRef = useRef<Float32Array | undefined>(undefined); // sector the live buffer belongs to
  const posRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset the canvas size and paint the original waveform underneath.
    const base = () => {
      const W = (canvas.width = canvas.clientWidth * 2);
      const H = (canvas.height = canvas.clientHeight * 2);
      ctx.clearRect(0, 0, W, H);
      if (original && original.length) drawWaveform(ctx, W, H, original, ORIG_COLOR);
      return { W, H };
    };

    if (recording) {
      // Grow the red trace from the left: one column per frame, appending the
      // newest mic level, until the canvas is full.
      const W = Math.max(1, Math.floor(canvas.clientWidth * 2));
      bufRef.current = new Float32Array(W);
      bufOrigRef.current = original; // this live buffer belongs to the current sector
      posRef.current = 0;
      const startTs = performance.now();
      // Advance the red front by elapsed/sector time so it reaches the far edge
      // (the end of the blue) exactly when the sector-length cap stops it. Fall
      // back to a frame-paced fill when no duration is provided.
      const spanMs = durationMs && durationMs > 0 ? durationMs : (W / 60) * 1000;
      const tick = () => {
        const buf = bufRef.current!;
        const elapsed = performance.now() - startTs;
        const target = Math.min(buf.length, Math.round((elapsed / spanMs) * buf.length));
        const lvl = getLevel();
        for (let x = posRef.current; x < target; x++) buf[x] = lvl; // fill any skipped columns
        posRef.current = target;
        const { H } = base();
        ctx.fillStyle = MINE_COLOR;
        for (let x = 0; x < posRef.current; x++) {
          const h = Math.max(1, Math.min(1, buf[x]) * H);
          ctx.fillRect(x, (H - h) / 2, 1, h);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }

    const { W, H } = base();
    const buf = bufRef.current;
    if (buf && posRef.current > 0 && bufOrigRef.current === original) {
      // Freeze the live red exactly where it stopped. Rescaling the take to the
      // full width here made it visibly jump forward after the auto-stop; keep
      // it identical to the last recorded frame instead.
      ctx.fillStyle = MINE_COLOR;
      const n = Math.min(posRef.current, buf.length, W);
      for (let x = 0; x < n; x++) {
        const h = Math.max(1, Math.min(1, buf[x]) * H);
        ctx.fillRect(x, (H - h) / 2, 1, h);
      }
    } else if (take && take.length) {
      // No live buffer (e.g. revisiting an earlier take): draw the full take.
      drawWaveform(ctx, W, H, take, MINE_COLOR);
    }
  }, [recording, original, take, getLevel, durationMs]);

  return <canvas ref={canvasRef} className="h-40 w-full rounded-[10px] bg-violet-deep" />;
}
