"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";

// Full-screen "combining" overlay shown at the end of a game while the final
// clip is stitched together (the mux/render request). That call is a single
// blocking request with no server-side progress, so — like the auto-detect and
// upload overlays — the bar is EASED toward ~95% while we wait and the result
// screen takes over when it lands. Used in every game mode (solo run, solo play,
// party) the moment the combine/finish button is pressed.
//
// Self-contained: give it `open` and it runs its own easing animation; nothing
// to drive from the caller.

export function CombineProgress({ open }: { open: boolean }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(0);
  const easeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      return;
    }
    const started = Date.now();
    setProgress(0.03);
    easeRef.current = window.setInterval(() => {
      const el = (Date.now() - started) / 1000;
      // Approaches ~0.95 over ~40s; muxes are usually much quicker.
      setProgress(Math.min(0.95, 0.05 + 0.9 * (1 - Math.exp(-el / 16))));
    }, 120);
    return () => {
      if (easeRef.current) window.clearInterval(easeRef.current);
      easeRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const pct = Math.round(progress * 100);
  const steps = [t("cmp.combine.gather"), t("cmp.combine.mix"), t("cmp.combine.finish")];
  const activeStep = pct < 38 ? 0 : pct < 78 ? 1 : 2;
  const phase =
    activeStep === 0
      ? t("cmp.combine.gathering")
      : activeStep === 1
        ? t("cmp.combine.mixing")
        : t("cmp.combine.finishing");

  return (
    <div className="cd-cmb-backdrop" role="dialog" aria-modal="true" aria-label={t("cmp.combine.title")}>
      <style>{`
        .cd-cmb-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(20,4,40,.66);}
        .cd-cmb-card{width:100%;max-width:430px;border-radius:22px;padding:26px;color:var(--color-cream);background:var(--color-violet);box-shadow:inset 0 0 0 3px rgba(255,255,255,.14),8px 8px 0 rgba(17,0,45,.55);}
        .cd-cmb-badge{width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--color-violet-lift);box-shadow:inset 0 0 0 2px rgba(255,255,255,.2),0 3px 0 rgba(17,0,45,.4);}
        .cd-cmb-pct{font-variant-numeric:tabular-nums;line-height:.9;}
        .cd-cmb-bar{position:relative;height:22px;border-radius:12px;background:rgba(17,0,45,.5);box-shadow:inset 0 2px 6px rgba(0,0,0,.45);overflow:hidden;}
        .cd-cmb-fill{height:100%;border-radius:12px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.3);transition:width .4s cubic-bezier(.4,0,.2,1);min-width:22px;background:linear-gradient(90deg,#f7941d,#ffb42e);}
        .cd-cmb-shim{position:absolute;inset:0;background:linear-gradient(100deg,transparent 32%,rgba(255,255,255,.3) 50%,transparent 68%);background-size:220% 100%;animation:cd-cmb-shim 1.15s linear infinite;}
        @keyframes cd-cmb-shim{from{background-position:210% 0}to{background-position:-210% 0}}
        .cd-cmb-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--color-sun);animation:cd-cmb-pulse 1s ease-in-out infinite;}
        @keyframes cd-cmb-pulse{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1.15)}}
        .cd-cmb-step{flex:1;text-align:center;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:6px 4px;border-radius:9px;transition:all .3s;}
        @media (prefers-reduced-motion: reduce){.cd-cmb-shim,.cd-cmb-dot{animation:none}}
      `}</style>

      <div className="cd-cmb-card">
        <div className="flex items-center gap-3.5">
          <div className="cd-cmb-badge">🎬</div>
          <div>
            <div className="font-display text-[19px] font-black leading-tight">{t("cmp.combine.title")}</div>
            <div className="text-[13px] font-bold text-cream/60">{t("cmp.combine.sub")}</div>
          </div>
        </div>

        <div className="mt-6 flex items-end justify-between">
          <div className="cd-cmb-pct font-display text-[64px] font-black">
            {pct}
            <span className="text-[30px]">%</span>
          </div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-cream/70">
            <span className="cd-cmb-dot" />
            {phase}
          </div>
        </div>

        <div className="mt-2 cd-cmb-bar">
          <div className="cd-cmb-fill" style={{ width: `${pct}%` }}>
            <div className="cd-cmb-shim" />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {steps.map((label, i) => {
            const on = i < activeStep;
            const now = i === activeStep;
            return (
              <div
                key={label}
                className="cd-cmb-step"
                style={{
                  background: now
                    ? "var(--color-magenta)"
                    : on
                      ? "rgba(39,225,161,.22)"
                      : "rgba(17,0,45,.35)",
                  color: now ? "#fff" : on ? "var(--color-mint)" : "rgba(255,246,236,.4)",
                  boxShadow: now ? "inset 0 0 0 2px rgba(255,255,255,.35)" : "none",
                }}
              >
                {on ? "✓ " : ""}
                {label}
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-[12px] font-semibold text-cream/45">
          {t("cmp.combine.hangTight")}
        </p>
      </div>
    </div>
  );
}
