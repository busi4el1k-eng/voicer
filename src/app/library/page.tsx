"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountBar } from "@/components/AccountBar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/components/LanguageProvider";
import { VideoThumb } from "@/components/VideoThumb";
import { formatShareId } from "@/lib/share-id";

// One fixed colour per player seat (1-4), matching the creator/editor.
const PLAYER_COLORS = ["#FF3D8B", "#FFD23F", "#27E1A1", "#38BDF8", "#A78BFA", "#FB923C", "#F87171"];

type Video = {
  id: string;
  title: string;
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
  createdAt: string;
};

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

// ── Sorting: pick one field to order by, plus one direction (ascending or
// descending). Fields are mutually exclusive; the direction toggle flips them. ─
type SortField = "date" | "rating" | "sectors" | "length";
type SortDir = "asc" | "desc";
// Labels are i18n keys, translated where the chips render.
const FIELDS: { key: SortField; labelKey: string }[] = [
  { key: "date", labelKey: "lib.field.date" },
  { key: "rating", labelKey: "lib.field.rated" },
  { key: "sectors", labelKey: "lib.field.sectors" },
  { key: "length", labelKey: "lib.field.length" },
];

// The comparable number behind each sort field.
const fieldValue = (v: Video, field: SortField): number => {
  switch (field) {
    case "date":
      return new Date(v.createdAt).getTime() || 0;
    case "rating":
      return v.rating;
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

// The shared Video library: public videos any user can browse and dub. Mirrors
// the creator's "Your videos" list layout, but read-only + open to everyone.
export default function LibraryPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The video whose "how do you want to play?" chooser is open (null = closed).
  const [chosen, setChosen] = useState<Video | null>(null);
  // Sort field (single-select) + direction. Default: newest first.
  const [field, setField] = useState<SortField>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  // Pagination: browse the library 25 at a time.
  const [page, setPage] = useState(1);

  // Ordered list, recomputed only when the videos or sort inputs change.
  const shown = useMemo(() => sortVideos(videos, field, dir), [videos, field, dir]);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/videos");
        const d = (await r.json()) as { videos: Video[] };
        if (alive) setVideos(d.videos ?? []);
      } catch {
        /* ignore — empty state below covers it */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <LanguageSwitcher />
        <AccountBar />
      </div>

      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Video<em>Library</em>
        </h1>
      </div>

      <div className="w-full max-w-3xl">
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
          ) : (
            <ul className="flex flex-col gap-3">
              {paged.map((v) => {
                return (
                  <li
                    key={v.id}
                    className="rounded-[12px] bg-violet-deep/40 p-3 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)]"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      {/* Preview */}
                      {v.sourceUrl && (
                        <div className="flex-none">
                          <VideoThumb src={v.sourceUrl} />
                        </div>
                      )}

                      {/* Title + creator + meta */}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[17px] font-bold text-cream">
                          {v.title || t("lib.untitled")}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-cream/70">
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
                            <span className="flex items-center gap-1">
                              {Array.from({ length: v.players }, (_, i) => (
                                <span
                                  key={i}
                                  title={t("lib.playerN", { n: i + 1 })}
                                  className="h-2.5 w-2.5 rounded-full shadow-[inset_0_0_0_1.5px_rgba(31,7,51,0.4)]"
                                  style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}
                                />
                              ))}
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

                      {/* Play — opens a chooser for Solo run vs Party mode. */}
                      <div className="flex flex-none items-center gap-2">
                        <button
                          onClick={() => setChosen(v)}
                          title={t("lib.dubThis")}
                          className="g-btn g-btn-start flex h-10 flex-1 items-center justify-center px-5 text-[13px] sm:flex-none"
                        >
                          {t("lib.play")}
                        </button>
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
          </div>
        </div>
      )}
    </main>
  );
}
