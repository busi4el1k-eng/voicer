"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// A trending-sidebar entry — a lighter shape than a full library card.
type TrendingVideo = {
  id: string;
  title: string;
  shareId: string | null;
  playCount: number;
  todayPlayCount: number;
};

// The minimum a video needs to open the "how do you want to play?" chooser.
// Both a full card (Video) and a trending entry (TrendingVideo) satisfy it.
type PlayableVideo = { id: string; title: string; shareId: string | null };

// The library's non-list facets, from /api/videos/facets — loaded separately so
// they never block the first page of videos from painting.
type Facets = {
  langCounts: Record<string, number>;
  totalAll: number;
  trending: { videos: TrendingVideo[]; fallback: boolean };
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
// Labels are i18n keys, translated where the chips render. Newest ("date") is
// first + the default: it paginates directly in the DB, so it loads fastest. The
// aggregate sorts (trending/popular/rated) only scan the library when picked.
const FIELDS: { key: SortField; labelKey: string }[] = [
  { key: "trending", labelKey: "lib.field.trending" },
  { key: "date", labelKey: "lib.field.date" },
  { key: "popular", labelKey: "lib.field.popular" },
  { key: "rating", labelKey: "lib.field.rated" },
  { key: "sectors", labelKey: "lib.field.sectors" },
  { key: "length", labelKey: "lib.field.length" },
];

// The special "all languages" filter key, and the bucket for videos whose
// language isn't one of the app locales (or is unknown).
const ALL_LANG = "all";
const OTHER_LANG = "other";

// Default the filter to the visitor's own language only if the library has at
// least this many videos in it — otherwise their tab would look empty/dead, so
// we fall back to "All" (which always has the most to show).
const MIN_LANG_VIDEOS = 3;

// How many cards per page (paginated client-side from the cached manifest).
const PAGE_SIZE = 24;

// ── Client-side library cache ────────────────────────────────────────────────
// The whole (lightweight) library is fetched once from /api/videos/all and kept
// in localStorage so that browsing — changing sort, direction, language, or page
// — never re-hits the server. We re-fetch only when the library's total count
// changes (a new video was added) or the cache is older than the freshness
// window, so aggregates like "trending today" still refresh on their own.
const MANIFEST_KEY = "lib-manifest-v1";
const MANIFEST_TTL_MS = 10 * 60 * 1000; // 10 minutes

type ManifestCache = { key: number; at: number; videos: Video[] };

function readManifest(): ManifestCache | null {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as ManifestCache;
    if (!Array.isArray(c.videos) || typeof c.key !== "number") return null;
    return c;
  } catch {
    return null;
  }
}

function writeManifest(c: ManifestCache) {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(c));
  } catch {
    /* storage full / disabled — the in-memory copy still works this session */
  }
}

// Which language tab a video belongs to: its own locale, or "other" (the server
// already collapses non-locale/unknown languages to "").
const bucketOf = (language: string) =>
  (LOCALES as readonly string[]).includes(language) ? language : OTHER_LANG;

// The ranking score for a sort field — mirrors the server's aggregate scoring so
// client-side sorting matches what the API used to return. Descending order puts
// the "best" first; the direction toggle flips it.
function scoreOf(v: Video, field: SortField): number {
  switch (field) {
    case "date":
      return new Date(v.createdAt).getTime();
    case "length":
      return v.durationMs;
    case "sectors":
      return v.lines;
    case "rating":
      return v.rating;
    case "popular":
      return v.ratingCount * 6 + v.rating;
    case "trending": {
      const ageHours = Math.max(0, (Date.now() - new Date(v.createdAt).getTime()) / 3_600_000);
      const engagement = v.todayPlayCount * 8 + v.playCount + v.ratingCount * 2 + v.rating;
      return engagement / Math.pow(ageHours + 2, 1.5);
    }
  }
}

// The shared Video library: public videos any user can browse and dub. Mirrors
// the creator's "Your videos" list layout, but read-only + open to everyone.
export default function LibraryPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  // The whole library, cached (see the manifest effect). null = not loaded yet.
  const [manifest, setManifest] = useState<Video[] | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  // Language filter: "all", one of the app locales, or "other". Defaults to the
  // visitor's language once the facets load (see the facets effect below).
  const [lang, setLang] = useState<string>(ALL_LANG);
  // The video whose "how do you want to play?" chooser is open (null = closed).
  const [chosen, setChosen] = useState<PlayableVideo | null>(null);
  // Sort field (single-select) + direction. Default: trending.
  const [field, setField] = useState<SortField>("trending");
  const [dir, setDir] = useState<SortDir>("desc");
  // Pagination: browse the library one page at a time (the server slices it).
  const [page, setPage] = useState(1);
  // We auto-pick the visitor's language exactly once, on the first facets load.
  const didAutoLang = useRef(false);

  const totalAll = facets?.totalAll ?? 0;
  const trending = facets?.trending ?? { videos: [], fallback: false };

  // Language tabs: one per language actually present, in app-locale order, with
  // a count each; "Other" (unknown language) comes last. Built from the server's
  // whole-library counts, so empty languages never show a dead tab.
  const langTabs = useMemo(() => {
    const counts = facets?.langCounts ?? {};
    const tabs = (LOCALES as readonly string[])
      .filter((l) => counts[l])
      .map((l) => ({
        key: l,
        label: LOCALE_META[l as keyof typeof LOCALE_META].label,
        count: counts[l],
      }));
    if (counts[OTHER_LANG])
      tabs.push({ key: OTHER_LANG, label: t("lib.lang.other"), count: counts[OTHER_LANG] });
    return tabs;
  }, [facets, t]);

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

  // Load the whole library once and keep it (localStorage + this component's
  // state), so sorting / filtering / paging all happen in the browser with no
  // further network calls. Runs when the total count is first known and again
  // only when that count changes (a new video was added) — the cache is keyed by
  // it. A short freshness window also lets time-based data (trending) refresh.
  useEffect(() => {
    if (!facets) return; // wait for the cheap count before deciding
    const key = facets.totalAll;
    let alive = true;

    (async () => {
      const cached = readManifest();
      // Cache hit: same total count and still fresh — reuse it, no network call.
      if (cached && cached.key === key && Date.now() - cached.at < MANIFEST_TTL_MS) {
        if (alive) setManifest(cached.videos);
        return;
      }
      try {
        const r = await fetch("/api/videos/all");
        const d = (await r.json()) as { videos: Video[] };
        if (!alive) return;
        const videos = d.videos ?? [];
        setManifest(videos);
        writeManifest({ key, at: Date.now(), videos });
      } catch {
        // Fall back to any cached copy (even if stale) rather than an empty list.
        if (alive) setManifest(cached?.videos ?? []);
      }
    })();
    return () => {
      alive = false;
    };
  }, [facets?.totalAll]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the facets (total count + language counts + trending). Trending is
  // language-specific, so refetch on lang change. On the very first load we also
  // use the counts to default the filter to the visitor's language (if enough
  // videos exist in it).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/videos/facets?lang=${encodeURIComponent(lang)}`);
        const d = (await r.json()) as Facets;
        if (!alive) return;
        setFacets(d);
        if (!didAutoLang.current) {
          didAutoLang.current = true;
          if (lang === ALL_LANG && (d.langCounts?.[locale] ?? 0) >= MIN_LANG_VIDEOS) {
            setLang(locale);
            setPage(1);
          }
        }
      } catch {
        /* facets are best-effort; the list still works without them */
      }
    })();
    return () => {
      alive = false;
    };
    // `locale` is read once (guarded by didAutoLang) to pick the default; we
    // deliberately don't refetch just because it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Derive the visible page entirely from the cached manifest: filter by
  // language, rank by the chosen field/direction, then slice the current page.
  const listLoaded = manifest !== null;
  const filtered = useMemo(() => {
    if (!manifest) return [];
    return lang === ALL_LANG ? manifest : manifest.filter((v) => bucketOf(v.language) === lang);
  }, [manifest, lang]);
  const sorted = useMemo(() => {
    const mul = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (scoreOf(a, field) - scoreOf(b, field)) * mul);
  }, [filtered, field, dir]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const videos = sorted.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);
  const hasNext = clampedPage < pageCount;

  const hasAny = sorted.length > 0 || totalAll > 0;

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
          {facets ? (
            `(${totalAll})`
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
          {trending.videos.length > 0 && (
            <aside className="lib-trending w-full lg:w-[290px] lg:flex-none">
              <div className="rounded-[14px] bg-gradient-to-br from-[rgba(255,61,139,0.14)] to-[rgba(255,180,46,0.10)] p-3 shadow-[inset_0_0_0_2px_rgba(255,61,139,0.35)]">
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
            default tab is the visitor's own language (see the facets effect). */}
        {langTabs.length > 1 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.08em] text-cream/40">
              {t("lib.langBy")}
            </span>
            {[{ key: ALL_LANG, label: t("lib.lang.all"), count: totalAll }, ...langTabs].map((tab) => {
              const active = lang === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => applyLang(tab.key)}
                  aria-pressed={active}
                  className={
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold transition " +
                    (active
                      ? "bg-sun/20 text-sun shadow-[inset_0_0_0_2px_#ffb42e]"
                      : "bg-violet-deep/40 text-cream/70 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)] hover:text-cream")
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
        {hasAny && (
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
                      ? "bg-mint/20 text-mint shadow-[inset_0_0_0_2px_#4fb8e6]"
                      : "bg-violet-deep/40 text-cream/70 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)] hover:text-cream")
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
              className="ml-1 flex items-center gap-1 rounded-full bg-violet-deep/40 px-3 py-1 text-[12px] font-bold text-cream/85 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)] transition hover:text-cream"
            >
              <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span>
              {dir === "desc" ? t("lib.desc") : t("lib.asc")}
            </button>
          </div>
        )}

        <div className="g-panel min-h-[300px]">
          {!listLoaded ? (
            <p className="text-center text-[13px] text-cream/50">{t("lib.loading")}</p>
          ) : videos.length > 0 ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {videos.map((v) => {
                return (
                  <li
                    key={v.id}
                    className="flex flex-col gap-2.5 rounded-[12px] bg-violet-deep/40 p-3 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)]"
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
                      className="g-btn g-btn-primary flex h-10 w-full items-center justify-center text-[13px]"
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
          ) : totalAll === 0 && facets ? (
            <p className="text-center text-[13px] leading-[1.6] text-cream/50">
              {t("lib.empty1")}
              <span className="font-bold text-mint">{t("lib.emptyPublic")}</span>
              {t("lib.empty2")}
            </p>
          ) : (
            // The library has videos, just none in the chosen language — offer a
            // one-tap way back to everything rather than a dead panel.
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-[13px] leading-[1.6] text-cream/50">{t("lib.lang.none")}</p>
              <button
                onClick={() => applyLang(ALL_LANG)}
                className="rounded-full bg-mint/20 px-4 py-1.5 text-[13px] font-bold text-mint shadow-[inset_0_0_0_2px_#4fb8e6] transition hover:bg-mint/30"
              >
                {t("lib.lang.showAll")}
              </button>
            </div>
          )}
        </div>

        {/* Pagination: prev / current page / next — shown whenever there's more
            than one page. Next disables on the last page. */}
        {listLoaded && (clampedPage > 1 || hasNext) && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => setPage(Math.max(1, clampedPage - 1))}
              disabled={clampedPage <= 1}
              className="rounded-full bg-violet-deep/40 px-4 py-1.5 text-[13px] font-bold text-cream/85 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)] transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-cream/85"
            >
              ← {t("lib.prev")}
            </button>
            <span className="text-[13px] font-bold text-cream/60">
              {t("lib.page")} {clampedPage}
            </span>
            <button
              onClick={() => setPage(clampedPage + 1)}
              disabled={!hasNext}
              className="rounded-full bg-violet-deep/40 px-4 py-1.5 text-[13px] font-bold text-cream/85 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)] transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-cream/85"
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
