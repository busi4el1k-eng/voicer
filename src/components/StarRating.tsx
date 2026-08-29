"use client";

import { useState } from "react";

// A 0–5 star picker. `value` of 0 shows no filled stars; clicking a star sets
// that many, and clicking the currently-selected star again drops it by one
// (so you can reach 0). Read-only mode just renders the filled state.
export function StarRating({
  value,
  onChange,
  readOnly = false,
  size = 26,
}: {
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;

  return (
    <div className="inline-flex items-center gap-1" role={readOnly ? undefined : "radiogroup"}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= shown;
        if (readOnly) {
          return (
            <Star key={n} filled={filled} size={size} />
          );
        }
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-pressed={n <= value}
            className="cursor-pointer bg-transparent p-0.5 leading-none transition-transform hover:scale-110"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange?.(value === n ? n - 1 : n)}
          >
            <Star filled={filled} size={size} />
          </button>
        );
      })}
    </div>
  );
}

function Star({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "#ffb42e" : "none"}
      stroke={filled ? "#ffb42e" : "rgba(255,246,236,0.35)"}
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.3l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.5z" />
    </svg>
  );
}
