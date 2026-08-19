"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountBar } from "@/components/AccountBar";
import { useI18n } from "@/components/LanguageProvider";
import { Poster } from "@/components/Poster";
import { SiteFooter } from "@/components/SiteFooter";
import { formatShareId } from "@/lib/share-id";
import { LOCALES, LOCALE_META } from "@/lib/i18n";

type Video = {
  id: string;
  title: string;
  // Content language (one of the app locales) or "" when unknown. Drives the
  // library's language filter so visitors see their own language first.
  language: string;
  shareId: string | null;
  status: string;
  sourceUrl: string;
  durationMs: number;
  lines: number;
  players: number;
  creator: string;
  creatorColor: string;
  rating: number; // average 0–5 rank (0 = unrated)
  ratingCount: number;
  playCount: number; // times the video has been run (played/dubbed), all-time
  todayPlayCount: number; // times it's been run today
  createdAt: string;
};

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

// ── Sorting: pick one field to order by, plus one direction (ascending or
// descending). Fields are mutually exclusive; the direction toggle flips them. ─
type SortField = "trending" | "date" | "rating" | "popular" | "sectors" | "length";
type SortDir = "asc" | "desc";
// Labels are i18n keys, translated where the chips render.
const FIELDS: { key: SortField; labelKey: string }[] = [
  { key: "trending", labelKey: "lib.field.trending" },
  { key: "date", labelKey: "lib.field.date" },
  { key: "popular", labelKey: "lib.field.popular" },
  { key: "rating", labelKey: "lib.field.rated" },
  { key: "sectors", labelKey: "lib.field.sectors" },
  { key: "length", labelKey: "lib.field.length" },
];

// Trending score: recent play velocity with a time-decay, so videos gaining
// traction *now* rise while stale ones sink even if they're all-time popular.
// Today's runs dominate; all-time runs, ratings, and average score are lighter
// signals. Dividing by (ageHours + 2)^1.5 (a HN/Reddit-style gravity) surfaces
// fresh, active videos over old ones — the essence of "trending".
const trendingScore = (v: Video): number => {
  const ageHours = Math.max(0, (Date.now() - new Date(v.createdAt).getTime()) / 3_600_000) || 0;
  const engagement = v.todayPlayCount * 8 + v.playCount + v.ratingCount * 2 + v.rating;
  return engagement / Math.pow(ageHours + 2, 1.5);
};

// The comparable number behind each sort field.
const fieldValue = (v: Video, field: SortField): number => {
  switch (field) {
    case "trending":
      return trendingScore(v);
    case "date":
      return new Date(v.createdAt).getTime() || 0;
    case "rating":
      return v.rating;
    // Popularity = how many people rated it. The most-often-rated videos rank
    // highest; ties break on the average score so a well-liked video edges out
    // an equally-rated but lower-scored one.
    case "popular":
      return v.ratingCount * 6 + v.rating;
    case "sectors":
      return v.lines;
    case "length":
      return v.durationMs;
  }
};

const sortVideos = (list: Video[], field: SortField, dir: SortDir): Video[] => {
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => (fieldValue(a, field) - fieldValue(b, field)) * mul);
};

// How many videos to show per page in the library.
const PER_PAGE = 25;

// How many videos the "Trending today" window shows.
const TRENDING_COUNT = 5;

// The special "all languages" filter key, and the bucket for videos whose
// language isn't one of the app locales (or is unknown).
const ALL_LANG = "all";
const OTHER_LANG = "other";

// A video's filter bucket: its locale if it's one we know, else "Other".
const langBucket = (v: Video): string =>
  v.language && (LOCALES as readonly string[]).includes(v.language) ? v.language : OTHER_LANG;

// Default the filter to the visitor's own language only if the library has at
// least this many videos in it — otherwise their tab would look empty/dead, so
// we fall back to "All" (which always has the most to show).
const MIN_LANG_VIDEOS = 3;

// Most popular today: the videos that were run (played/dubbed) the most times
// today. On a quiet day with no runs yet, we fall back to the all-time
// most-played videos so the window is still useful rather than empty —
// `fallback` tells the UI which set it's showing so it can label it and show
// the matching count.
type Trending = { videos: Video[]; fallback: boolean };
const topTrending = (list: Video[]): Trending => {
  const today = list
    .filter((v) => v.todayPlayCount > 0)
    .sort((a, b) => b.todayPlayCount - a.todayPlayCount || b.playCount - a.playCount);
  if (today.length > 0) return { videos: today.slice(0, TRENDING_COUNT), fallback: false };

  const allTime = list
    .filter((v) => v.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount || b.rating - a.rating);
  return { videos: allTime.slice(0, TRENDING_COUNT), fallback: true };
};

// The shared Video library: public videos any user can browse and dub. Mirrors
// the creator's "Your videos" list layout, but read-only + open to everyone.
export default function LibraryPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Language filter: "all", one of the app locales, or "other". Defaults to the
  // visitor's language once videos load (see the fetch effect below).
  const [lang, setLang] = useState<string>(ALL_LANG);
  // The video whose "how do you want to play?" chooser is open (null = closed).
  const [chosen, setChosen] = useState<Video | null>(null);
  // Sort field (single-select) + direction. Default: newest first.
  const [field, setField] = useState<SortField>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  // Pagination: browse the library 25 at a time.
  const [page, setPage] = useState(1);

  // Videos in the selected language (or all of them when "all" is picked).
  const inLang = useMemo(
    () => (lang === ALL_LANG ? videos : videos.filter((v) => langBucket(v) === lang)),
    [videos, lang],
  );
  // Language tabs: one per language actually present, in app-locale order, with
  // a count each; "Other" (unknown language) comes last. Only built from the
  // videos we have, so empty languages never show a dead tab.
  const langTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of videos) counts.set(langBucket(v), (counts.get(langBucket(v)) ?? 0) + 1);
    const tabs = (LOCALES as readonly string[])
      .filter((l) => counts.has(l))
      .map((l) => ({ key: l, label: LOCALE_META[l as keyof typeof LOCALE_META].label, count: counts.get(l)! }));
    if (counts.has(OTHER_LANG)) tabs.push({ key: OTHER_LANG, label: t("lib.lang.other"), count: counts.get(OTHER_LANG)! });
    return tabs;
  }, [videos, t]);

  // Ordered list, recomputed only when the (language-filtered) videos or sort
  // inputs change.
  const shown = useMemo(() => sortVideos(inLang, field, dir), [inLang, field, dir]);
  // Today's top-5 trending within the current language (falls back to all-time
  // top-played on a quiet day).
  const trending = useMemo(() => topTrending(inLang), [inLang]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const current = Math.min(page, pageCount); // clamp if the list shrank
  const paged = shown.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  // Change the ordering and jump back to the first page.
  const applyField = (key: SortField) => {
    setField(key);
    setPage(1);
  };
  const toggleDir = () => {
    setDir((d) => (d === "desc" ? "asc" : "desc"));
    setPage(1);
  };
  // Switch language filter and jump back to the first page.
  const applyLang = (key: string) => {
    setLang(key);
    setPage(1);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/videos");
        const d = (await r.json()) as { videos: Video[] };
        const list = d.videos ?? [];
        if (!alive) return;
        setVideos(list);
        // Default the filter to the visitor's language, but only if enough
        // videos exist in it — otherwise keep "All" so the page isn't empty.
        // This is what stops a non-Russian visitor from landing on a wall of
        // videos they can't understand.
        const mine = list.filter((v) => langBucket(v) === locale).length;
        if (mine >= MIN_LANG_VIDEOS) setLang(locale);
      } catch {
        /* ignore — empty state below covers it */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // Mount-only: we read the initial `locale` to pick a default language once,
    // and deliberately don't re-run (and re-override the filter) if it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <AccountBar />
      </div>

      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Video<em>Library</em>
        </h1>
      </div>

      <div className="w-full">
        <h2 className="g-title">
          {t("lib.publicVideos")}{" "}
          {loaded ? (
            `(${videos.length})`
          ) : (
            <span
              aria-label={t("lib.loadingAria")}
              className="ml-1 inline-block h-[15px] w-[15px] animate-spin rounded-full border-2 border-cream/25 border-t-mint align-[-2px]"
            />
          )}
        </h2>

        {/* Content: on desktop, a left sidebar (trending) beside the video
            list; on phones they stack (trending above the full list), since two
            columns can't sit side-by-side on a narrow screen. */}
        <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start lg:justify-center">
          {/* Trending today: a compact window of the 5 videos pulling in the
              most ratings today. On desktop it's the left column (sticky so it
              stays in view while the list scrolls); hidden on a quiet day. */}
          {loaded && trending.videos.length > 0 && (
            <aside className="lib-trending w-full lg:w-[290px] lg:flex-none">
              <div className="rounded-[14px] bg-gradient-to-br from-[rgba(255,61,139,0.14)] to-[rgba(255,210,63,0.10)] p-3 shadow-[inset_0_0_0_2px_rgba(255,61,139,0.35)]">
                <div className="mb-2 flex items-center gap-1.5">
                  <span aria-hidden className="text-[15px]">🔥</span>
                  <h3 className="font-display text-[14px] font-black uppercase tracking-[0.06em] text-cream">
                    {t(trending.fallback ? "lib.trending.mostPlayed" : "lib.trending.title")}
                  </h3>
                </div>
                <ol className="flex flex-col gap-1">
                  {trending.videos.map((v, i) => {
                    // Runs today when we have today's data; otherwise (fallback)
                    // the all-time run total.
                    const count = trending.fallback ? v.playCount : v.todayPlayCount;
                    return (
                      <li key={v.id}>
                        <button
                          onClick={() => setChosen(v)}
                          title={t("lib.dubThis")}
                          className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition hover:bg-cream/[0.06]"
                        >
                          <span className="w-4 flex-none text-center font-display text-[14px] font-black text-sun">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-cream">
                            {v.title || t("lib.untitled")}
                          </span>
                          <span
                            className="flex flex-none items-center gap-1 text-[12px] text-cream/70"
                            title={t("lib.trending.runs", { n: count })}
                          >
                            <span className="text-sun">▶</span>
                            <span className="font-display font-bold text-cream/85">{count}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </aside>
          )}

          {/* Main column: sort bar + the full video list + pagination. On
              desktop it sits to the right of the trending sidebar. */}
          <div className="w-full min-w-0 flex-1 lg:max-w-[720px]">
        {/* Language filter: browse videos by their content language. Shown only
            when the library actually spans more than one language, so a
            single-language library isn't cluttered with a pointless bar. The
            default tab is the visitor's own language (see the fetch effect). */}
        {loaded && langTabs.length > 1 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.08em] text-cream/40">
              {t("lib.langBy")}
            </span>
            {[{ key: ALL_LANG, label: t("lib.lang.all"), count: videos.length }, ...langTabs].map((tab) => {
              const active = lang === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => applyLang(tab.key)}
                  aria-pressed={active}
                  className={
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold transition " +
                    (active
                      ? "bg-sun/20 text-sun shadow-[inset_0_0_0_2px_#FFD23F]"
                      : "bg-violet-deep/40 text-cream/70 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)] hover:text-cream")
                  }
                >
                  {tab.label}
                  <span className={active ? "text-sun/70" : "text-cream/40"}>{tab.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {/* Sort bar: pick one field to order by + a direction toggle. Only
            shown once there are videos to sort. */}
        {loaded && videos.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.08em] text-cream/40">
              {t("lib.sortBy")}
            </span>
            {FIELDS.map((f) => {
              const active = field === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => applyField(f.key)}
                  aria-pressed={active}
                  className={
                    "rounded-full px-3 py-1 text-[12px] font-bold transition " +
                    (active
                      ? "bg-mint/20 text-mint shadow-[inset_0_0_0_2px_#5cffb6]"
                      : "bg-violet-deep/40 text-cream/70 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)] hover:text-cream")
                  }
                >
                  {t(f.labelKey)}
                </button>
              );
            })}
            {/* Direction toggle: descending (high→low / newest first) ↔ ascending. */}
            <button
              onClick={toggleDir}
              title={dir === "desc" ? t("lib.descTitle") : t("lib.ascTitle")}
              aria-label={dir === "desc" ? t("lib.descTitle") : t("lib.ascTitle")}
              className="ml-1 flex items-center gap-1 rounded-full bg-violet-deep/40 px-3 py-1 text-[12px] font-bold text-cream/85 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)] transition hover:text-cream"
            >
              <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span>
              {dir === "desc" ? t("lib.desc") : t("lib.asc")}
            </button>
          </div>
        )}

        <div className="g-panel min-h-[300px]">
          {!loaded ? (
            <p className="text-center text-[13px] text-cream/50">{t("lib.loading")}</p>
          ) : videos.length === 0 ? (
            <p className="text-center text-[13px] leading-[1.6] text-cream/50">
              {t("lib.empty1")}
              <span className="font-bold text-mint">{t("lib.emptyPublic")}</span>
              {t("lib.empty2")}
            </p>
          ) : inLang.length === 0 ? (
            // The library has videos, just none in the chosen language — offer a
            // one-tap way back to everything rather than a dead panel.
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-[13px] leading-[1.6] text-cream/50">{t("lib.lang.none")}</p>
              <button
                onClick={() => applyLang(ALL_LANG)}
                className="rounded-full bg-mint/20 px-4 py-1.5 text-[13px] font-bold text-mint shadow-[inset_0_0_0_2px_#5cffb6] transition hover:bg-mint/30"
              >
                {t("lib.lang.showAll")}
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {paged.map((v) => {
                return (
                  <li
                    key={v.id}
                    className="flex flex-col gap-2.5 rounded-[12px] bg-violet-deep/40 p-3 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)]"
                  >
                    {/* Preview — big static poster that plays on hover/tap (no zoom). */}
                    {v.sourceUrl && (
                      <div className="overflow-hidden rounded-[8px]">
                        <Poster src={v.sourceUrl} />
                      </div>
                    )}

                    {/* Play — opens a chooser for Solo run vs Party mode. */}
                    <button
                      onClick={() => setChosen(v)}
                      title={t("lib.dubThis")}
                      className="g-btn g-btn-start flex h-10 w-full items-center justify-center text-[13px]"
                    >
                      {t("lib.play")}
                    </button>

                    {/* Info, kept under the Play button */}
                    <div className="min-w-0">
                      <div className="truncate font-display text-[16px] font-bold text-cream">
                        {v.title || t("lib.untitled")}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-cream/70">
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="grid h-5 w-5 flex-none place-items-center rounded-full font-display text-[11px] font-black text-white"
                            style={{ backgroundColor: v.creatorColor }}
                          >
                            {v.creator.charAt(0).toUpperCase()}
                          </span>
                          <span className="text-cream/85">{v.creator}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-display font-bold text-cream/85">{v.lines}</span>
                          <span className="text-cream/45">
                            {v.lines === 1 ? t("lib.line") : t("lib.lines")}
                          </span>
                        </span>
                        {v.ratingCount > 0 ? (
                          <span
                            className="flex items-center gap-1"
                            title={t("lib.ratedBy", { n: v.ratingCount })}
                          >
                            <span className="text-sun">★</span>
                            <span className="font-display font-bold text-cream/85">
                              {v.rating.toFixed(1)}
                            </span>
                            <span className="text-cream/45">({v.ratingCount})</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-cream/35">
                            <span>★</span>
                            <span>{t("lib.unrated")}</span>
                          </span>
                        )}
                        {v.players > 0 && (
                          <span
                            className="flex items-center gap-1"
                            title={t("lib.recommendedPlayers", { n: v.players })}
                          >
                            <span aria-hidden className="text-cream/70">
                              👤
                            </span>
                            <span className="font-display font-bold text-cream/85">{v.players}</span>
                          </span>
                        )}
                        {v.durationMs > 0 && (
                          <span className="text-cream/55">{fmtDuration(v.durationMs)}</span>
                        )}
                        {v.shareId && (
                          <span className="font-display font-bold tracking-[0.1em] text-mint">
                            {formatShareId(v.shareId)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pagination: prev / page indicator / next — only when there's more
            than one page. Buttons disable at the ends. */}
        {loaded && pageCount > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={current <= 1}
              className="rounded-full bg-violet-deep/40 px-4 py-1.5 text-[13px] font-bold text-cream/85 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)] transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-cream/85"
            >
              ← {t("lib.prev")}
            </button>
            <span className="text-[13px] font-bold text-cream/60">
              {t("lib.pageOf", { a: current, b: pageCount })}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={current >= pageCount}
              className="rounded-full bg-violet-deep/40 px-4 py-1.5 text-[13px] font-bold text-cream/85 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)] transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-cream/85"
            >
              {t("lib.next")} →
            </button>
          </div>
        )}
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/dashboard" className="text-[13px] text-cream/50 underline">
            {t("lib.backToLobby")}
          </Link>
        </div>
      </div>

      {/* "How do you want to play?" — pick Solo run or Party mode for the chosen
          video. Solo drops you straight into the dub; Party carries the video's
          share code into the party setup. */}
      {chosen && (
        <div className="g-modal-overlay" onClick={() => setChosen(null)}>
          <div className="g-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="g-modal-x"
              aria-label={t("common.close")}
              onClick={() => setChosen(null)}
            >
              ×
            </button>
            <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
              🎬
            </div>
            <h3 className="g-modal-title">{t("lib.chooseTitle")}</h3>
            <p className="g-modal-sub">
              {t("lib.chooseSub", { title: chosen.title || t("lib.untitled") })}
            </p>
            <button
              type="button"
              className="g-btn g-btn-start w-full"
              onClick={() => router.push(`/play/run/${chosen.id}`)}
            >
              {t("lib.soloRun")}
            </button>
            <button
              type="button"
              className="g-btn g-btn-primary w-full"
              onClick={() =>
                router.push(chosen.shareId ? `/party?code=${chosen.shareId}` : "/party")
              }
            >
              {t("lib.partyMode")}
            </button>
            <button
              type="button"
              className="g-btn g-btn-primary w-full"
              onClick={() =>
                router.push(
                  chosen.shareId ? `/party?code=${chosen.shareId}&mode=duel` : "/party?mode=duel",
                )
              }
            >
              {t("lib.duelMode")}
            </button>
          </div>
        </div>
      )}

      <SiteFooter />
    </main>
  );
}
