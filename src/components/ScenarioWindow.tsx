"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/components/LanguageProvider";

// The split-view "scenario" window shown beside the video while you dub a
// sector (solo run and party). It renders the scene's REAL screenplay — every
// sector's transcript, in timeline order, coloured per player — built from the
// video's segments via `scenarioFromSegments`. The line you're dubbing right now
// (`currentKey`) is highlighted and auto-scrolled into view, so this window is
// also your "what to say" cue — no separate line box needed under the video.

export type ScenarioLine = { key: string; player: number; speaker: string; text: string };

// A sector as it comes back from the video API / editor state. Only the fields
// the scenario needs; callers' richer types are structurally compatible.
export type SectorLike = {
  id: string;
  startMs: number;
  player?: number | null;
  label?: string | null;
  transcript?: string | null;
};

// Build the on-screen script from a video's sectors: drop empty transcripts,
// order by start time, and label each line by its sector name (falling back to
// "Player N"). Keyed by sector id so the current line can be highlighted.
export function scenarioFromSegments(segs: readonly SectorLike[]): ScenarioLine[] {
  return [...segs]
    .filter((s) => (s.transcript ?? "").trim().length > 0)
    .sort((a, b) => a.startMs - b.startMs)
    .map((s) => ({
      key: s.id,
      player: s.player ?? 1,
      // Empty when the creator didn't name the line; ScenarioWindow fills the
      // "Player N" fallback so it can be localised.
      speaker: (s.label ?? "").trim(),
      text: (s.transcript ?? "").trim(),
    }));
}

// Colour per player seat so lines are easy to scan in the script.
const seatColor = (seat: number) =>
  ["#8952dc", "#FF3D8B", "#27E1A1", "#f6b73c", "#4fc3f7"][seat % 5];

export function ScenarioWindow({
  mySeat,
  lines,
  currentKey,
}: {
  mySeat: number;
  lines: ScenarioLine[];
  currentKey?: string;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);

  // Keep the line being dubbed centred as you advance — scrolls only this
  // window, never the page.
  useEffect(() => {
    const el = curRef.current;
    const box = scrollRef.current;
    if (!el || !box) return;
    const er = el.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const delta = er.top - br.top - (box.clientHeight / 2 - el.clientHeight / 2);
    box.scrollBy({ top: delta, behavior: "smooth" });
  }, [currentKey]);

  return (
    <div className="g-panel flex h-full max-h-full flex-col overflow-hidden">
      <div className="mb-3 flex items-center justify-between border-b border-cream/10 pb-2">
        <span className="font-display text-[14px] font-bold uppercase tracking-[0.1em] text-mint">
          {t("cmp.scenario.title")}
        </span>
        <span className="font-display text-[11px] uppercase tracking-[0.08em] text-cream/40">
          {lines.length ? t("cmp.scenario.lines", { n: lines.length }) : t("cmp.scenario.script")}
        </span>
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <p className="text-[13px] leading-snug text-cream/45">{t("cmp.scenario.empty")}</p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="cd-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1.5 max-h-[46vh] lg:max-h-none"
        >
          {lines.map((l) => {
            const mine = l.player === mySeat;
            const isCurrent = !!currentKey && l.key === currentKey;
            return (
              <div
                key={l.key}
                ref={isCurrent ? curRef : undefined}
                className={`rounded-[12px] px-3 py-2.5 transition-colors ${
                  isCurrent
                    ? "bg-magenta/[0.16] shadow-[inset_0_0_0_2px_#ff3d8b]"
                    : mine
                      ? "bg-white/[0.06] shadow-[inset_0_0_0_1.5px_rgba(39,225,161,0.4)]"
                      : ""
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="grid h-5 min-w-5 place-items-center rounded-[6px] px-1.5 font-display text-[10px] font-black text-white"
                    style={{ backgroundColor: seatColor(l.player) }}
                  >
                    P{l.player}
                  </span>
                  <span className="font-display text-[11px] font-bold uppercase tracking-[0.06em] text-cream/60">
                    {l.speaker || t("creator.playerN", { n: l.player })}
                    {mine && !isCurrent && <span className="ml-1.5 text-mint">{t("common.you")}</span>}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto rounded-full bg-magenta px-2 py-0.5 font-display text-[10px] font-black uppercase tracking-[0.08em] text-cream">
                      {t("cmp.scenario.yourLine")}
                    </span>
                  )}
                </div>
                <p
                  className={`leading-snug ${
                    isCurrent
                      ? "text-[16px] font-semibold text-cream"
                      : mine
                        ? "text-[14px] text-cream"
                        : "text-[14px] text-cream/60"
                  }`}
                >
                  {l.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
