"use client";

import { useState } from "react";
import { StarRating } from "@/components/StarRating";

// NOTE: mocked data — this is a placeholder history until real per-run results
// are persisted and queried. Swap MOCK_HISTORY for a fetch of the player's runs.
type Entry = {
  id: string;
  when: string;
  mode: "Solo" | "Party";
  title: string;
  stars: number; // 0–5 rating this performance earned
  verdict: string;
  players?: number;
};

const MOCK_HISTORY: Entry[] = [
  { id: "h1", when: "Today", mode: "Party", title: "Crazy Nikki", stars: 5, verdict: "Scene stealer", players: 3 },
  { id: "h2", when: "Yesterday", mode: "Solo", title: "The Office — cold open", stars: 4, verdict: "Solid take" },
  { id: "h3", when: "Jul 30", mode: "Party", title: "Titanic — the door", stars: 5, verdict: "Legendary", players: 4 },
  { id: "h4", when: "Jul 28", mode: "Solo", title: "Joker on the stairs", stars: 2, verdict: "Needs work" },
  { id: "h5", when: "Jul 25", mode: "Party", title: "Shrek — swamp intro", stars: 4, verdict: "Great energy", players: 2 },
  { id: "h6", when: "Jul 21", mode: "Solo", title: "Batman voice test", stars: 3, verdict: "Decent" },
];

export function PerformanceHistory() {
  const [open, setOpen] = useState(false);

  const avg =
    MOCK_HISTORY.reduce((n, e) => n + e.stars, 0) / (MOCK_HISTORY.length || 1);

  return (
    <>
      <button type="button" className="g-card" onClick={() => setOpen(true)}>
        <div className="g-card-inner">
          <div className="g-ficon">📊</div>
          <section>
            <h4>Performance history</h4>
            <p>Look back at your recent dubs and the scores they earned.</p>
          </section>
        </div>
      </button>

      {open && (
        <div className="g-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="g-modal"
            style={{ maxWidth: 460, textAlign: "left", alignItems: "stretch" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="g-modal-x"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>

            <h3 className="g-modal-title text-center">Performance history</h3>
            <p className="g-modal-sub text-center">
              Your last {MOCK_HISTORY.length} dubs · avg{" "}
              <span className="font-black text-sun">{avg.toFixed(1)} ★</span>
            </p>

            <div className="mt-2 flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
              {MOCK_HISTORY.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-[10px] bg-white/5 px-3 py-2.5"
                >
                  <span className="w-[64px] flex-none font-display text-[11px] font-bold uppercase tracking-[0.04em] text-cream/45">
                    {e.when}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-[6px] px-1.5 py-0.5 font-display text-[10px] font-black uppercase ${
                          e.mode === "Party" ? "bg-mint/20 text-mint" : "bg-sun/20 text-sun"
                        }`}
                      >
                        {e.mode}
                        {e.players ? ` · ${e.players}p` : ""}
                      </span>
                      <span className="truncate text-[13px] text-cream/90">{e.title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <StarRating value={e.stars} readOnly size={14} />
                      <span className="text-[11px] text-cream/50">{e.verdict}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-1 text-center text-[11px] text-cream/40">
              Sample data — real results will appear here as you play.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
