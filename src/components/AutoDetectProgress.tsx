"use client";

// The "downloading" window that pops up while AI auto-detect builds the dub
// sectors. The backend job only reports a coarse status (processing → ready), so
// — like the upload/bed overlay — the bar is EASED toward ~95% while the job
// runs and snaps to 100% when the sectors land. Styled in the Gartic register:
// chunky, cream-on-violet, hard offset shadow, zero blur.

import { useI18n } from "@/components/LanguageProvider";

export type AutoState = "working" | "done" | "error";

export function AutoDetectProgress({
  open,
  progress,
  phase,
  state,
  count = 0,
  error = "",
  onClose,
}: {
  open: boolean;
  progress: number;
  phase: string;
  state: AutoState;
  count?: number;
  error?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const done = state === "done";
  const errored = state === "error";
  const closable = done || errored;

  const fill = errored
    ? "linear-gradient(90deg,#f7941d,#d17a0f)"
    : done
      ? "linear-gradient(90deg,#38a8dc,#2f92c8)"
      : "linear-gradient(90deg,#f7941d,#ffd23f)";

  // The three real phases of the job, lit up as the bar advances.
  const steps = [t("cmp.auto.step.listen"), t("cmp.auto.step.transcribe"), t("cmp.auto.step.place")];
  const activeStep = errored ? -1 : done ? 3 : pct < 30 ? 0 : pct < 62 ? 1 : 2;

  return (
    <div
      className="cd-adp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("cmp.auto.aria")}
      onClick={closable ? onClose : undefined}
    >
      <style>{`
        .cd-adp-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(20,4,40,.62);}
        .cd-adp-card{width:100%;max-width:430px;border-radius:22px;padding:26px;color:var(--color-cream);background:var(--color-violet);box-shadow:inset 0 0 0 3px rgba(255,255,255,.14),8px 8px 0 rgba(17,0,45,.55);}
        .cd-adp-badge{width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--color-violet-lift);box-shadow:inset 0 0 0 2px rgba(255,255,255,.2),0 3px 0 rgba(17,0,45,.4);}
        .cd-adp-pct{font-variant-numeric:tabular-nums;line-height:.9;}
        .cd-adp-bar{position:relative;height:22px;border-radius:12px;background:rgba(17,0,45,.5);box-shadow:inset 0 2px 6px rgba(0,0,0,.45);overflow:hidden;}
        .cd-adp-fill{height:100%;border-radius:12px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.3);transition:width .4s cubic-bezier(.4,0,.2,1);min-width:22px;}
        .cd-adp-shim{position:absolute;inset:0;background:linear-gradient(100deg,transparent 32%,rgba(255,255,255,.3) 50%,transparent 68%);background-size:220% 100%;animation:cd-adp-shim 1.15s linear infinite;}
        @keyframes cd-adp-shim{from{background-position:210% 0}to{background-position:-210% 0}}
        .cd-adp-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--color-sun);animation:cd-adp-pulse 1s ease-in-out infinite;}
        @keyframes cd-adp-pulse{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1.15)}}
        .cd-adp-step{flex:1;text-align:center;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:6px 4px;border-radius:9px;transition:all .3s;}
        @media (prefers-reduced-motion: reduce){.cd-adp-shim,.cd-adp-dot{animation:none}}
      `}</style>

      <div className="cd-adp-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3.5">
          <div className="cd-adp-badge">{errored ? "😕" : done ? "✅" : "🪄"}</div>
          <div>
            <div className="font-display text-[19px] font-black leading-tight">
              {errored ? t("cmp.auto.failedTitle") : done ? t("cmp.auto.readyTitle") : t("cmp.auto.workingTitle")}
            </div>
            <div className="text-[13px] font-bold text-cream/60">
              {errored
                ? t("cmp.auto.failedSub")
                : done
                  ? count
                    ? t("cmp.auto.placed", {
                        n: count,
                        sectors: count === 1 ? t("editor.sector") : t("editor.sectors"),
                      })
                    : t("cmp.auto.noSpeechSub")
                  : t("cmp.auto.listeningSub")}
            </div>
          </div>
        </div>

        {/* Big percentage */}
        <div className="mt-6 flex items-end justify-between">
          <div
            className="cd-adp-pct font-display text-[64px] font-black"
            style={{ color: errored ? "#ffc07a" : done ? "var(--color-mint)" : "var(--color-cream)" }}
          >
            {pct}
            <span className="text-[30px]">%</span>
          </div>
          {!closable && (
            <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-cream/70">
              <span className="cd-adp-dot" />
              {phase}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-2 cd-adp-bar">
          <div className="cd-adp-fill" style={{ width: `${Math.max(pct, errored ? 100 : 0)}%`, background: fill }}>
            {!closable && <div className="cd-adp-shim" />}
          </div>
        </div>

        {/* Phase steps */}
        <div className="mt-4 flex gap-2">
          {steps.map((label, i) => {
            const on = i < activeStep;
            const now = i === activeStep;
            return (
              <div
                key={label}
                className="cd-adp-step"
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

        {/* Error message */}
        {errored && error && (
          <div className="mt-4 rounded-xl bg-[rgba(17,0,45,.4)] px-4 py-3 text-[13px] font-semibold text-magenta">
            {error}
          </div>
        )}

        {/* Accuracy warning — auto-detect is a rough draft, not final. */}
        {done && count > 0 && (
          <div className="mt-4 flex gap-2.5 rounded-xl bg-[rgba(255,210,63,.12)] px-4 py-3 text-[13px] font-semibold leading-[1.5] text-cream/85 shadow-[inset_0_0_0_2px_rgba(255,210,63,.35)]">
            <span aria-hidden className="text-[16px] leading-none">
              ⚠️
            </span>
            <span>{t("cmp.auto.warning")}</span>
          </div>
        )}

        {/* Footer */}
        {closable && (
          <button
            type="button"
            onClick={onClose}
            className="g-btn g-btn-primary mt-6 h-12 w-full text-[16px]"
          >
            {done ? (count ? t("cmp.auto.showSectors") : t("cmp.auto.gotIt")) : t("cmp.auto.close")}
          </button>
        )}
      </div>
    </div>
  );
}
