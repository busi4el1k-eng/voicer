"use client";

import { useId } from "react";
import type { Locale } from "@/lib/i18n";

// Inline SVG flags. Emoji flags (🇬🇧🇷🇺…) don't render on Windows — the browser
// falls back to the two-letter code ("RU", "RO") — so we draw the flags instead,
// which look identical on every platform. Sized by height; width follows each
// flag's natural aspect ratio.
export function Flag({ locale, size = 16, className = "" }: { locale: Locale; size?: number; className?: string }) {
  const uid = useId();
  const style = { height: size, width: "auto" as const, display: "block" };
  const cls = `rounded-[2px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)] ${className}`;

  switch (locale) {
    // France — blue / white / red vertical thirds.
    case "fr":
      return (
        <svg viewBox="0 0 3 2" style={style} className={cls} aria-hidden>
          <rect width="1" height="2" x="0" fill="#0055A4" />
          <rect width="1" height="2" x="1" fill="#FFFFFF" />
          <rect width="1" height="2" x="2" fill="#EF4135" />
        </svg>
      );

    // Romania — blue / yellow / red vertical thirds.
    case "ro":
      return (
        <svg viewBox="0 0 3 2" style={style} className={cls} aria-hidden>
          <rect width="1" height="2" x="0" fill="#002B7F" />
          <rect width="1" height="2" x="1" fill="#FCD116" />
          <rect width="1" height="2" x="2" fill="#CE1126" />
        </svg>
      );

    // Russia — white / blue / red horizontal thirds.
    case "ru":
      return (
        <svg viewBox="0 0 3 2" style={style} className={cls} aria-hidden>
          <rect width="3" height="2" fill="#FFFFFF" />
          <rect width="3" height="0.667" y="0.667" fill="#0039A6" />
          <rect width="3" height="0.667" y="1.333" fill="#D52B1E" />
        </svg>
      );

    // Spain — red / yellow (double height) / red horizontal bands.
    case "es":
      return (
        <svg viewBox="0 0 3 2" style={style} className={cls} aria-hidden>
          <rect width="3" height="2" fill="#AA151B" />
          <rect width="3" height="1" y="0.5" fill="#F1BF00" />
        </svg>
      );

    // United Kingdom — Union Jack (used for English).
    case "en":
    default:
      return (
        <svg viewBox="0 0 60 30" style={style} className={cls} aria-hidden>
          <clipPath id={`${uid}-t`}>
            <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
          </clipPath>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
          <path
            d="M0,0 L60,30 M60,0 L0,30"
            clipPath={`url(#${uid}-t)`}
            stroke="#C8102E"
            strokeWidth="4"
          />
          <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
        </svg>
      );
  }
}
