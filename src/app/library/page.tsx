"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountBar } from "@/components/AccountBar";
import { VideoThumb } from "@/components/VideoThumb";
import { formatShareId } from "@/lib/share-id";

// One fixed colour per player seat (1-4), matching the creator/editor.
const PLAYER_COLORS = ["#FF3D8B", "#FFD23F", "#27E1A1", "#38BDF8"];

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
};

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

// The shared Video library: public videos any user can browse and dub. Mirrors
// the creator's "Your videos" list layout, but read-only + open to everyone.
export default function LibraryPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The video whose "how do you want to play?" chooser is open (null = closed).
  const [chosen, setChosen] = useState<Video | null>(null);

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
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>

      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Video<em>Library</em>
        </h1>
      </div>

      <div className="w-full max-w-3xl">
        <h2 className="g-title">
          Public videos{" "}
          {loaded ? (
            `(${videos.length})`
          ) : (
            <span
              aria-label="Loading videos"
              className="ml-1 inline-block h-[15px] w-[15px] animate-spin rounded-full border-2 border-cream/25 border-t-mint align-[-2px]"
            />
          )}
        </h2>

        <div className="g-panel min-h-[300px]">
          {!loaded ? (
            <p className="text-center text-[13px] text-cream/50">Loading the library…</p>
          ) : videos.length === 0 ? (
            <p className="text-center text-[13px] leading-[1.6] text-cream/50">
              No public videos yet. Creators can share their videos here by switching one to{" "}
              <span className="font-bold text-mint">Public</span> in the video creator.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {videos.map((v) => {
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
                          {v.title || "Untitled"}
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
                            <span className="text-cream/45">line{v.lines === 1 ? "" : "s"}</span>
                          </span>
                          {v.players > 0 && (
                            <span className="flex items-center gap-1">
                              {Array.from({ length: v.players }, (_, i) => (
                                <span
                                  key={i}
                                  title={`Player ${i + 1}`}
                                  className="h-2.5 w-2.5 rounded-full shadow-[inset_0_0_0_1.5px_rgba(31,7,51,0.4)]"
                                  style={{ background: PLAYER_COLORS[i % 4] }}
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
                          title="Dub this video"
                          className="g-btn g-btn-start flex h-10 flex-1 items-center justify-center px-5 text-[13px] sm:flex-none"
                        >
                          Play
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link href="/dashboard" className="text-[13px] text-cream/50 underline">
            Back to lobby
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
              aria-label="Close"
              onClick={() => setChosen(null)}
            >
              ×
            </button>
            <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
              🎬
            </div>
            <h3 className="g-modal-title">How do you want to play?</h3>
            <p className="g-modal-sub">
              <b className="text-cream">{chosen.title || "Untitled"}</b> — pick a mode to dub it.
            </p>
            <button
              type="button"
              className="g-btn g-btn-start w-full"
              onClick={() => router.push(`/play/run/${chosen.id}`)}
            >
              🎬 Solo run
            </button>
            <button
              type="button"
              className="g-btn g-btn-primary w-full"
              onClick={() =>
                router.push(chosen.shareId ? `/party?code=${chosen.shareId}` : "/party")
              }
            >
              🎉 Party mode
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
