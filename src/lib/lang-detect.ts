import { LOCALES, type Locale } from "@/lib/i18n";

// Best-effort guess of a video's content language from its title, used only as a
// fallback for library rows that have no explicit `language` set. The reliable
// signal is script: Cyrillic titles are Russian. For the Latin-script locales
// (es/fr/ro/en) we lean on language-specific diacritics and a few high-frequency
// stopwords, then fall back to English (the app default) for plain ASCII. It is
// intentionally cheap and imperfect — a creator can always override it.

const CYRILLIC = /[Ѐ-ӿ]/;

// Diacritics that are strongly characteristic of one Latin locale.
const RO_CHARS = /[ăâîșțşţĂÂÎȘȚŞŢ]/;
const ES_CHARS = /[ñ¿¡Ñ]/;
const FR_CHARS = /[çœàèùêîôûëïüÇŒ]/;

// Small stopword sets — matched as whole words, case-insensitively. Kept short
// and distinctive so a single hit is a decent signal for short titles.
const RO_WORDS = /\b(și|sau|este|pentru|filmul|dublaj|nu|cu|din|care)\b/i;
const ES_WORDS = /\b(el|la|los|las|una|para|que|con|está|película|doblaje|mejor)\b/i;
const FR_WORDS = /\b(le|la|les|une|des|est|pour|avec|c'est|film|doublage)\b/i;
const EN_WORDS = /\b(the|and|with|this|movie|dub|best|scene|when)\b/i;

export function guessTitleLang(title: string | null | undefined): Locale | "" {
  const s = (title ?? "").trim();
  if (!s) return "";
  if (CYRILLIC.test(s)) return "ru";

  // Diacritic evidence is the strongest Latin signal — check it first.
  if (RO_CHARS.test(s)) return "ro";
  if (ES_CHARS.test(s)) return "es";
  if (FR_CHARS.test(s)) return "fr";

  // Then whole-word stopword hits.
  if (RO_WORDS.test(s)) return "ro";
  if (ES_WORDS.test(s)) return "es";
  if (FR_WORDS.test(s)) return "fr";
  if (EN_WORDS.test(s)) return "en";

  // Plain ASCII with no clear signal: treat as English (the app default), so a
  // non-Russian visitor's default view isn't empty.
  return "en";
}

// Normalise an arbitrary stored value into a known locale, or "" when it isn't
// one of ours (guards against legacy/bad data reaching the UI as a phantom tab).
export function normalizeLang(value: string | null | undefined): Locale | "" {
  return value && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : "";
}

// The language to attribute a video to: its explicit tag if valid, else the
// title guess. Never returns "" for a non-empty title.
export function resolveLang(stored: string | null | undefined, title: string | null | undefined): Locale | "" {
  return normalizeLang(stored) || guessTitleLang(title);
}
