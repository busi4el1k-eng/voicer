"use client";

import { useEffect, useState } from "react";
import { StarRating } from "@/components/StarRating";
import { useI18n } from "@/components/LanguageProvider";

// Real performance history: fetched from /api/history (the player's finished
// party games, with the scene title, when it happened, player count and the
// star rating they earned). Solo runs aren't persisted yet, so this lists party
// games only. Guests / players with no games see an empty state.
type Entry = {
  id: string;
  when: string; // ISO date
  mode: "Solo" | "Party";
  title: string;
  players?: number;
  stars: number | null; // 0–5, or null if not rated that game
};

// Turn an ISO date into a compact "Today / Yesterday / Mon D" label, localised
// to the given locale (month names) and translated for Today/Yesterday.
function whenLabel(iso: string, tr: (k: string) => string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = d.getTime();
  if (time >= startToday) return tr("cmp.hist.today");
  if (time >= startToday - 86_400_000) return tr("cmp.hist.yesterday");
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

const verdictKey = (stars: number | null) =>
  stars == null ? "cmp.hist.notRated" : `cmp.hist.v${stars}`;

export function PerformanceHistory() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load lazily the first time the window is opened.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/history");
        const d = (await r.json()) as { entries?: Entry[] };
        if (!cancelled) setEntries(d.entries ?? []);
      } catch {
        /* leave empty */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  const rated = entries.filter((e) => e.stars != null);
  const avg = rated.length ? rated.reduce((n, e) => n + (e.stars ?? 0), 0) / rated.length : null;

  return (
    <>
      <button type="button" className="g-card" onClick={() => setOpen(true)}>
        <div className="g-card-inner">
          <div className="g-ficon">📊</div>
          <section>
            <h4>{t("cmp.hist.title")}</h4>
            <p>{t("cmp.hist.cardText")}</p>
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
              aria-label={t("cmp.hist.close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>

            <h3 className="g-modal-title text-center">{t("cmp.hist.title")}</h3>
            <p className="g-modal-sub text-center">
              {!loaded ? (
                t("cmp.hist.loading")
              ) : entries.length === 0 ? (
                t("cmp.hist.none")
              ) : (
                <>
                  {t("cmp.hist.last", {
                    n: entries.length,
                    games: entries.length === 1 ? t("cmp.hist.game") : t("cmp.hist.games"),
                  })}
                  {avg != null && (
                    <>
                      {" · "}
                      {t("cmp.hist.avg")}{" "}
                      <span className="font-black text-sun">{avg.toFixed(1)} ★</span>
                    </>
                  )}
                </>
              )}
            </p>

            {loaded && entries.length === 0 ? (
              <p className="mt-3 text-center text-[13px] leading-relaxed text-cream/50">
                {t("cmp.hist.emptyBody")}
              </p>
            ) : (
              <div className="cd-scroll mt-2 flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1">
                {entries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 rounded-[10px] bg-white/5 px-3 py-2.5"
                  >
                    <span className="w-[64px] flex-none font-display text-[11px] font-bold uppercase tracking-[0.04em] text-cream/45">
                      {whenLabel(e.when, t, locale)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-[6px] px-1.5 py-0.5 font-display text-[10px] font-black uppercase ${
                            e.mode === "Party" ? "bg-mint/20 text-mint" : "bg-sun/20 text-sun"
                          }`}
                        >
                          {e.mode === "Party" ? t("cmp.hist.party") : t("cmp.hist.solo")}
                          {e.players ? ` · ${e.players}p` : ""}
                        </span>
                        <span className="truncate text-[13px] text-cream/90">{e.title}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <StarRating value={e.stars ?? 0} readOnly size={14} />
                        <span className="text-[11px] text-cream/50">{t(verdictKey(e.stars))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
