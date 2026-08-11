"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from "@/lib/i18n";

type Vars = Record<string, string | number>;
type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Vars) => string;
};

const I18nContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "cinemadub.locale";

// Wraps the whole app so any component can read the chosen language. SSR always
// renders the default (English) and the client re-applies the saved locale after
// mount — same first paint on both sides, so no hydration mismatch, just a brief
// switch to the saved language on load.
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Apply the saved language after mount. SSR + first client render both use
  // the default, so this deliberate post-mount setState is what avoids a
  // hydration mismatch (rather than causing a problematic cascade).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isLocale(stored)) setLocaleState(stored);
    } catch {
      /* storage blocked — stay on the default */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    // Mirror into a cookie too, so the choice can be read server-side later.
    document.cookie = `${STORAGE_KEY}=${l};path=/;max-age=31536000;samesite=lax`;
  }, []);

  const t = useCallback((key: string, vars?: Vars) => translate(locale, key, vars), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

// Hook for logic, attributes, and computed strings.
export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Fallback so components still render (in English) if used outside a provider.
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key: string, vars?: Vars) => translate(DEFAULT_LOCALE, key, vars),
  };
}

// Inline translated text — safe to drop straight into server components.
export function T({ k, vars }: { k: string; vars?: Vars }) {
  const { t } = useI18n();
  return <>{t(k, vars)}</>;
}
