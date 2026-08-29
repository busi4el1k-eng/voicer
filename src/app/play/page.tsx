"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountBar } from "@/components/AccountBar";
import { VideoStage } from "@/components/VideoStage";
import { useI18n } from "@/components/LanguageProvider";
import { formatShareId, formatShareInput } from "@/lib/share-id";

type Video = {
  id: string;
  title: string;
  shareId: string | null;
  status: string;
  sourceUrl: string;
  durationMs: number;
  lines: number;
};

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

export default function PlayHome() {
  const router = useRouter();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const trimmed = code.trim();
    if (!trimmed) return setErr(t("solo.enterShareCode"));
    setBusy(true);
    setErr("");
    setVideo(null);
    try {
      const r = await fetch(`/api/solo/lookup?code=${encodeURIComponent(trimmed)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("solo.lookupFailed"));
      setVideo(d.video as Video);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("solo.lookupFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>
      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Solo<em>Dub</em>
        </h1>
      </div>

      <div className="w-full max-w-xl">
        <h2 className="g-title">{t("solo.enterCode")}</h2>

        {/* Code search */}
        <div className="g-panel">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(formatShareInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
              placeholder={t("solo.codePh")}
              maxLength={9}
              autoFocus
              className="flex-1 rounded-[10px] bg-violet-deep/60 px-4 py-3 font-display text-[16px] font-bold uppercase tracking-[0.12em] text-cream placeholder:font-normal placeholder:tracking-normal placeholder:text-cream/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            />
            <button onClick={search} disabled={busy} className="g-btn g-btn-primary px-5">
              {busy ? "…" : t("solo.search")}
            </button>
          </div>
          {err && <p className="mt-3 text-[13px] text-magenta">{err}</p>}
          <p className="mt-3 text-[12px] leading-[1.5] text-cream/50">{t("solo.hint")}</p>

          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="mb-2 text-[12px] text-cream/50">{t("solo.noCode")}</p>
            <Link
              href="/library"
              className="g-btn g-btn-primary flex w-full items-center justify-center gap-2"
            >
              {t("solo.browseLibrary")}
            </Link>
          </div>
        </div>

        {/* Found video — game info + mock play */}
        {video && (
          <div className="g-panel mt-4">
            <div className="mb-4">
              <VideoStage src={video.sourceUrl} />
            </div>
            <h3 className="font-display text-[22px] font-black text-cream">
              {video.title || t("lib.untitled")}
            </h3>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  {t("solo.code")}
                </div>
                <div className="mt-1 font-display text-[15px] font-black tracking-[0.1em] text-mint">
                  {video.shareId ? formatShareId(video.shareId) : "—"}
                </div>
              </div>
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  {t("solo.lines")}
                </div>
                <div className="mt-1 font-display text-[15px] font-black text-cream">
                  {video.lines}
                </div>
              </div>
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  {t("solo.length")}
                </div>
                <div className="mt-1 font-display text-[15px] font-black text-cream">
                  {video.durationMs ? fmtDuration(video.durationMs) : "—"}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => router.push(`/play/run/${video.id}`)}
                disabled={video.lines === 0}
                className="g-btn g-btn-start w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {video.lines === 0 ? t("solo.noLinesYet") : t("solo.play")}
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
