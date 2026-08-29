"use client";

import { useEffect, useRef, useState } from "react";
import { getClientId } from "@/lib/client-id";
import { useI18n } from "@/components/LanguageProvider";

// ❤️ / 🍅 reactions on a "Clips of Today" podium clip. Unlimited — every tap adds
// one — so taps bump the count instantly (optimistic) and are batched into a
// debounced request. The server keeps the running total (and rate-limits abuse),
// and its authoritative count is folded back in on each flush.

type Kind = "heart" | "tomato";
type Counts = Record<Kind, number>;

const REACTIONS: { kind: Kind; emoji: string; labelKey: string; accent: string }[] = [
  { kind: "heart", emoji: "❤️", labelKey: "clip.love", accent: "#ff4d8d" },
  { kind: "tomato", emoji: "🍅", labelKey: "clip.tomato", accent: "#ff6a3d" },
];

const FLUSH_MS = 500;

export function ClipReactions({ clipId }: { clipId: string }) {
  const { t } = useI18n();
  // null = still loading the real totals — we render a shimmer instead of "0" so
  // the count never flashes 0 before the saved number arrives.
  const [counts, setCounts] = useState<Counts | null>(null);
  const [pop, setPop] = useState<Record<Kind, number>>({ heart: 0, tomato: 0 });
  const pending = useRef<Counts>({ heart: 0, tomato: 0 });
  const timers = useRef<Partial<Record<Kind, ReturnType<typeof setTimeout>>>>({});

  // Initial totals.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/clip/react?clipId=${encodeURIComponent(clipId)}`);
        const d = (await r.json()) as { counts: Counts };
        if (alive) setCounts(r.ok && d.counts ? d.counts : { heart: 0, tomato: 0 });
      } catch {
        // Lookup failed — reveal zeros so the buttons still work.
        if (alive) setCounts({ heart: 0, tomato: 0 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clipId]);

  const flush = async (kind: Kind) => {
    const delta = pending.current[kind];
    if (delta <= 0) return;
    pending.current[kind] = 0;
    try {
      const r = await fetch("/api/clip/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ clipId, kind, delta, reactorKey: getClientId() }),
      });
      const d = (await r.json()) as { counts: Counts };
      if (r.ok && d.counts) {
        // Server is authoritative; re-add any taps that landed mid-flight. If the
        // server throttled us, the total simply stops climbing (anti-bot).
        setCounts((c) => (c ? { ...c, [kind]: d.counts[kind] + pending.current[kind] } : c));
      }
    } catch {
      /* keep the optimistic count on a network hiccup */
    }
  };

  const bump = (kind: Kind) => {
    // Ignore taps until the real base count has loaded (avoids counting from 0).
    if (counts === null) return;
    setCounts((c) => (c ? { ...c, [kind]: c[kind] + 1 } : c));
    setPop((p) => ({ ...p, [kind]: p[kind] + 1 }));
    pending.current[kind] += 1;
    clearTimeout(timers.current[kind]);
    timers.current[kind] = setTimeout(() => void flush(kind), FLUSH_MS);
  };

  // Flush any un-sent taps when the player closes / unmounts.
  useEffect(() => {
    return () => {
      (["heart", "tomato"] as Kind[]).forEach((k) => {
        clearTimeout(timers.current[k]);
        void flush(k);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-4 flex items-stretch justify-center gap-3">
      {REACTIONS.map(({ kind, emoji, labelKey, accent }) => {
        const loading = counts === null;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => bump(kind)}
            disabled={loading}
            aria-label={t(labelKey)}
            aria-busy={loading}
            className="group flex min-w-[128px] select-none items-center gap-3 rounded-2xl border-2 bg-white/[0.06] px-5 py-3 transition-all duration-100 hover:bg-white/[0.1] active:scale-95 disabled:cursor-progress disabled:active:scale-100"
            style={{
              borderColor: `${accent}66`,
              boxShadow: `inset 0 0 0 1px ${accent}22, 0 4px 0 0 rgba(8,34,48,0.45)`,
            }}
          >
            <span
              key={pop[kind]}
              className={`text-[30px] leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)] ${
                loading ? "opacity-70" : "cd-react-pop"
              }`}
              aria-hidden
            >
              {emoji}
            </span>
            <span className="flex flex-col items-start leading-none">
              {loading ? (
                <span
                  className="cd-react-skeleton mt-0.5 mb-1 h-[18px] w-9 rounded-[5px]"
                  aria-hidden
                />
              ) : (
                <span
                  className="cd-react-reveal font-display text-[22px] font-black tabular-nums"
                  style={{ color: accent }}
                >
                  {counts[kind]}
                </span>
              )}
              <span className="mt-0.5 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-cream/50">
                {t(labelKey)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
