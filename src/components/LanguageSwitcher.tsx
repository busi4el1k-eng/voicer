"use client";

import { useState } from "react";
import { LOCALES, LOCALE_META } from "@/lib/i18n";
import { useI18n } from "@/components/LanguageProvider";
import { Flag } from "@/components/Flag";

// Flag button sitting beside the account menu. Shows the current language's flag
// and opens a small app-styled dropdown to switch. English is the default.
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("lang.choose")}
        title={t("lang.choose")}
        className="grid h-9 w-9 place-items-center rounded-[12px] shadow-[inset_0_0_0_2px_#3f8fc8,0_3px_0_0_rgba(8,34,48,0.4)] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#3f8fc8,0_1px_0_0_rgba(8,34,48,0.4)]"
        style={{ background: "rgba(16,57,79,0.7)" }}
      >
        <Flag locale={locale} size={16} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-50 flex gap-1 rounded-[12px] p-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
            style={{ backgroundColor: "#10394f", boxShadow: "inset 0 0 0 2px #3f8fc8" }}
          >
            {LOCALES.map((l) => {
              const m = LOCALE_META[l];
              const active = l === locale;
              return (
                <button
                  key={l}
                  onClick={() => {
                    setLocale(l);
                    setOpen(false);
                  }}
                  aria-label={m.label}
                  title={m.label}
                  aria-pressed={active}
                  className={`grid h-9 w-9 place-items-center rounded-[9px] transition ${
                    active
                      ? "shadow-[inset_0_0_0_2px_#4fb8e6]"
                      : "opacity-70 hover:opacity-100 hover:bg-violet-lift/50"
                  }`}
                >
                  <Flag locale={l} size={18} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
