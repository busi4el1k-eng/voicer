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

// Wraps the whole app so any component can read the chosen language. The root
// layout reads the locale cookie server-side and passes it as `initialLocale`,
// so SSR and the first client render already paint in the chosen language — no
// English flash on reload and no hydration mismatch. The post-mount effect only
// reconciles with localStorage (the source of truth the switcher writes to).
export function LanguageProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  // Reconcile with localStorage after mount. This matches the cookie in the
  // normal case; it only changes anything if the two ever diverge (e.g. storage
  // was updated in another tab), so it won't cause a hydration mismatch.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isLocale(stored) && stored !== locale) setLocaleState(stored);
    } catch {
      /* storage blocked — stay on the initial locale */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
