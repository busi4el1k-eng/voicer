"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Admin dub browser. Lists finished dubs (Clip rows) with an inline preview and
// one-tap Download / Open / Copy-link, so the owner can grab "top clips of today"
// to edit + post to socials without ever opening the R2/Spaces console. Data and
// the force-download come from server routes; admin is re-checked there.

type Dub = {
  id: string;
  videoUrl: string;
  downloadUrl: string;
  title: string;
  author: string;
  mode: string;
  createdAt: string;
  durationMs: number;
  score: number;
  metrics: {
    loudness: number;
    lra: number;
    crest: number;
    silence: number;
    voicedMs: number;
  };
};

type Range = "today" | "week" | "all";
type Sort = "new" | "score";

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "score", label: "Top energy" },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDur(ms: number): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const pill =
  "rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)]";
const pillOn = "bg-sun/20 text-sun shadow-[inset_0_0_0_2px_#ffb42e]";
const pillOff = "text-cream/60 hover:text-cream";

export function DubsAdmin() {
  const [dubs, setDubs] = useState<Dub[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [range, setRange] = useState<Range>("today");
  const [sort, setSort] = useState<Sort>("new");
  const [copied, setCopied] = useState<string>("");

  const load = useCallback(async () => {
    setLoaded(false);
    const r = await fetch(`/api/admin/dubs?range=${range}&sort=${sort}`, {
      cache: "no-store",
    });
    const d = (await r.json().catch(() => ({}))) as { dubs?: Dub[] };
    setDubs(d.dubs ?? []);
    setLoaded(true);
  }, [range, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <main className="g-screen">
      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Dubs<em>Admin</em>
        </h1>
      </div>

      <div className="w-full max-w-[1100px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/creators" className="text-[13px] text-cream/50 underline">
            → Creators admin
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`${pill} ${range === r.key ? pillOn : pillOff}`}
              >
                {r.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-cream/15" />
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`${pill} ${sort === s.key ? pillOn : pillOff}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          <p className="py-16 text-center text-[13px] text-cream/50">Loading dubs…</p>
        ) : dubs.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-cream/50">
            No dubs in this window yet.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12px] text-cream/40">
              {dubs.length} dub{dubs.length === 1 ? "" : "s"}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dubs.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-col overflow-hidden rounded-[12px] bg-violet-deep/50 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)]"
                >
                  <div className="relative bg-black">
                    <video
                      src={d.videoUrl}
                      controls
                      preload="metadata"
                      playsInline
                      className="aspect-video w-full bg-black"
                    />
                    <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-sun px-2 py-0.5 text-[11px] font-black text-violet-deep">
                      ⚡ {d.score}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="min-h-[34px]">
                      <p className="line-clamp-2 text-[13px] font-bold text-cream">
                        {d.title}
                      </p>
                    </div>
                    <p className="text-[11px] text-cream/50">
                      {d.author} · <span className="uppercase">{d.mode}</span>
                      {d.durationMs ? ` · ${fmtDur(d.durationMs)}` : ""} · {fmtDate(d.createdAt)}
                    </p>

                    <div className="mt-1 flex flex-wrap gap-2">
                      <a
                        href={d.downloadUrl}
                        className="rounded-full bg-sun/20 px-3 py-1.5 text-[12px] font-bold text-sun shadow-[inset_0_0_0_2px_#ffb42e]"
                      >
                        ↓ Download
                      </a>
                      <a
                        href={d.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`${pill} ${pillOff}`}
                      >
                        Open
                      </a>
                      <button
                        onClick={() => copy(d.videoUrl, d.id)}
                        className={`${pill} ${pillOff}`}
                      >
                        {copied === d.id ? "Copied!" : "Copy URL"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
