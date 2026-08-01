"use client";

import { useEffect, useRef } from "react";

// The word "dubthatmovie" rendered as chunky outlined letters that fill with a
// mint liquid from left to right as `progress` (0..1) advances. Used as the
// upload + Demucs separation progress indicator, in the app's Gartic register.

const VW = 1200;
const VH = 210;
const TEXTLEN = 1080; // glyphs stretched to exactly this, centred
const X0 = (VW - TEXTLEN) / 2; // left edge of the glyph run
const WIDTH = TEXTLEN;
const WORD = "dubthatmovie";

const textProps = {
  x: VW / 2,
  y: 150,
  textAnchor: "middle" as const,
  textLength: TEXTLEN,
  lengthAdjust: "spacingAndGlyphs" as const,
  fontSize: 132,
  style: {
    fontFamily: "var(--font-fredoka), var(--font-nunito), system-ui, sans-serif",
    fontWeight: 900,
  },
};

export function LiquidLogo({ progress }: { progress: number }) {
  const fillRef = useRef<SVGPathElement>(null);
  const pRef = useRef(progress);
  useEffect(() => {
    pRef.current = progress;
  }, [progress]);

  useEffect(() => {
    let raf = 0;
    let phase = 0;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      phase += 0.09;
      const p = Math.max(0, Math.min(1, pRef.current));
      const front = X0 + p * WIDTH;
      // Wiggle the advancing surface only while actively filling.
      const amp = reduce || p <= 0 || p >= 1 ? 0 : 8;
      const top = -10;
      const bottom = VH + 10;
      const steps = 16;
      let d = `M ${X0 - 40} ${bottom} L ${X0 - 40} ${top} L ${front} ${top} `;
      for (let i = 0; i <= steps; i++) {
        const y = top + ((bottom - top) * i) / steps;
        const x = front + Math.sin(phase + i * 0.6) * amp;
        d += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
      }
      d += `L ${X0 - 40} ${bottom} Z`;
      fillRef.current?.setAttribute("d", d);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      role="img"
      aria-label={`${WORD} loading ${Math.round(progress * 100)} percent`}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id="ll-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8affd0" />
          <stop offset="0.5" stopColor="#5cffb6" />
          <stop offset="1" stopColor="#2fbf8e" />
        </linearGradient>
        <clipPath id="ll-clip">
          <text {...textProps}>{WORD}</text>
        </clipPath>
      </defs>

      {/* Liquid, clipped to the letter shapes: faint empty vessel + rising fill. */}
      <g clipPath="url(#ll-clip)">
        <rect x="0" y="0" width={VW} height={VH} fill="rgba(255,246,236,0.12)" />
        <path ref={fillRef} d="" fill="url(#ll-grad)" />
      </g>

      {/* Chunky dark outline + a thin light inner edge, over the liquid. */}
      <text
        {...textProps}
        fill="none"
        stroke="#201255"
        strokeWidth="9"
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {WORD}
      </text>
      <text {...textProps} fill="none" stroke="rgba(255,246,236,0.45)" strokeWidth="2">
        {WORD}
      </text>
    </svg>
  );
}
