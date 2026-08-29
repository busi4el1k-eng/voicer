"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { GameIcon, type GameIconName } from "@/components/GameIcon";

// One rotating "how to play" slide instead of a static 2×2 grid. It advances on
// its own every few seconds (with a filling progress bar so you feel the beat),
// and you can also swipe it by hand or tap the dots. Each step gets its own
// accent so flipping through feels lively.

type Step = {
  icon: GameIconName;
  titleKey: string;
  textKey: string;
  accent: string;
  // Optional hand-made illustration shown instead of the default GameIcon.
  image?: string;
};

const STEPS: Step[] = [
  // The four how-to-play steps…
  { icon: "listen", titleKey: "home.step.listen.t", textKey: "home.step.listen.d", accent: "#4fb8e6", image: "/howto/listen.png" },
  { icon: "perform", titleKey: "home.step.perform.t", textKey: "home.step.perform.d", accent: "#f7941d", image: "/howto/perform.png" },
  { icon: "judged", titleKey: "home.step.judged.t", textKey: "home.step.judged.d", accent: "#4a90c8", image: "/howto/judged.png" },
  { icon: "win", titleKey: "home.step.win.t", textKey: "home.step.win.d", accent: "#ffb42e", image: "/howto/win.png" },
  // …then the reasons to come back.
  { icon: "friends", titleKey: "home.feat.party.t", textKey: "home.feat.party.d", accent: "#4fb8e6", image: "/howto/friends.png" },
  { icon: "share", titleKey: "home.feat.share.t", textKey: "home.feat.share.d", accent: "#ffb42e", image: "/howto/share.png" },
];

const INTERVAL = 5000; // ms per slide

export function HowToPlayCarousel() {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0); // live px offset while a finger is down
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const go = useCallback((n: number) => setIndex(((n % STEPS.length) + STEPS.length) % STEPS.length), []);

  // Auto-advance, unless a finger is down / hovering, or the user prefers less motion.
  useEffect(() => {
    if (paused || dragging || reduce.current) return;
    const id = setTimeout(() => go(index + 1), INTERVAL);
    return () => clearTimeout(id);
  }, [index, paused, dragging, go]);

  const onDown = (e: React.PointerEvent) => {
    setDragging(true);
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDrag(e.clientX - startX.current);
  };
  const onUp = () => {
    if (!dragging) return;
    const w = viewport.current?.clientWidth ?? 1;
    // A swipe past a quarter of the width flips to the neighbouring slide.
    if (drag < -w * 0.25) go(index + 1);
    else if (drag > w * 0.25) go(index - 1);
    setDrag(0);
    setDragging(false);
  };

  return (
    <div
      className="flex flex-1 flex-col"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Sliding track — all steps side by side, translated to the active one. */}
      <div
        ref={viewport}
        className="relative flex-1 cursor-grab touch-pan-y select-none overflow-hidden rounded-[12px] active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
            transition: dragging ? "none" : "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          {STEPS.map((s, i) =>
            s.image ? (
              // Image slide: the illustration fills the window height on the
              // left, with just its short instruction pushed to the right (no
              // title — the artwork already carries the word). object-contain +
              // min-h-0 keep it from growing the window taller.
              <div
                key={s.titleKey}
                className="flex h-full w-full shrink-0 items-center gap-4 px-3"
                aria-hidden={i !== index}
              >
                <div className="grid h-full min-h-0 min-w-0 flex-1 place-items-center overflow-hidden">
                  <img
                    src={s.image}
                    alt=""
                    aria-hidden
                    className="max-h-[90%] max-w-[90%] rounded-[16px] object-contain shadow-[0_4px_0_0_#0a2b3d]"
                  />
                </div>
                <p className="w-[150px] shrink-0 text-left text-[15px] font-semibold leading-[1.5] text-cream/80">
                  {t(s.textKey)}
                </p>
              </div>
            ) : (
              <div
                key={s.titleKey}
                className="flex w-full shrink-0 flex-col items-center justify-center gap-4 px-6 text-center"
                aria-hidden={i !== index}
              >
                <div
                  className="grid h-[84px] w-[84px] place-items-center rounded-[18px]"
                  style={{
                    background: "radial-gradient(120% 120% at 30% 20%, #226c99, #0f3a54)",
                    boxShadow: `inset 0 0 0 2px ${s.accent}55, 0 4px 0 0 #0a2b3d`,
                  }}
                >
                  <GameIcon name={s.icon} size={46} />
                </div>
                <div
                  className="font-display text-[11px] font-black uppercase tracking-[0.22em] tnum"
                  style={{ color: s.accent }}
                >
                  {String(i + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
                </div>
                <h3 className="font-display text-[24px] font-black uppercase leading-tight text-cream">
                  {t(s.titleKey)}
                </h3>
                <p className="max-w-[46ch] text-[15px] font-semibold leading-[1.5] text-cream/75">
                  {t(s.textKey)}
                </p>
              </div>
            ),
          )}
        </div>
      </div>

      {/* Dots — tap to jump between slides. */}
      <div className="mt-4 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s.titleKey}
            type="button"
            aria-label={`${t(s.titleKey)}`}
            onClick={() => go(i)}
            className="h-[10px] rounded-full transition-all duration-300"
            style={{
              width: i === index ? 28 : 10,
              background: i === index ? s.accent : "rgba(255,246,236,0.28)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
