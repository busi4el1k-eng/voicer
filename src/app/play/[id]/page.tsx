"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { downloadHref } from "@/lib/download";
import { useMic, type RecordResult } from "@/lib/audio/useMic";
import { CombineProgress } from "@/components/CombineProgress";
import { ShareButton } from "@/components/ShareButton";
import { useI18n } from "@/components/LanguageProvider";

type Seg = { id: string; startMs: number; endMs: number; label: string; transcript: string };
type Upload = { id: string; title: string; sourceUrl: string; segments: Seg[] };
type Phase = "loading" | "intro" | "studio" | "exporting" | "done" | "empty" | "error";

// One sector's amplitude envelope + pitch (Hz) contour, N points across time.
type Trace = { peaks: number[]; pitch: number[] };
type Pcm = { data: Float32Array; rate: number };

const N = 56; // sample points per sector for the compare views
const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

// --- signal analysis (runs client-side, on demand) ---------------------------

function envelope(data: Float32Array, from: number, to: number): number[] {
  const len = Math.max(1, to - from);
  const step = Math.max(1, Math.floor(len / N));
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    let p = 0;
    const base = from + i * step;
    for (let j = 0; j < step; j++) {
      const v = data[base + j];
      if (v) p = Math.max(p, Math.abs(v));
    }
    out.push(p);
  }
  return out;
}

// Autocorrelation pitch (Hz) for a window centered on `center`; 0 if unvoiced.
function pitchAt(data: Float32Array, center: number, rate: number): number {
  const W = 1024;
  const start = Math.max(0, Math.floor(center - W / 2));
  const end = Math.min(data.length, start + W);
  const n = end - start;
  if (n < W / 2) return 0;
  let rms = 0;
  for (let i = start; i < end; i++) rms += data[i] * data[i];
  if (Math.sqrt(rms / n) < 0.015) return 0;
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.floor(rate / 80);
  let best = 0;
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = start; i < end - lag; i++) corr += data[i] * data[i + lag];
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  return bestLag > 0 ? rate / bestLag : 0;
}

function contour(data: Float32Array, from: number, to: number, rate: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    out.push(pitchAt(data, Math.floor(from + ((i + 0.5) / N) * (to - from)), rate));
  }
  return out;
}

function trace(pcm: Pcm, from: number, to: number): Trace {
  return { peaks: envelope(pcm.data, from, to), pitch: contour(pcm.data, from, to, pcm.rate) };
}

async function decodeBlob(blob: Blob): Promise<Pcm> {
  const buf = await blob.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  const audio = await ac.decodeAudioData(buf);
  await ac.close();
  return { data: audio.getChannelData(0), rate: audio.sampleRate };
}

const P_LO = Math.log2(90);
const P_HI = Math.log2(350);
function normPitch(hz: number): number | null {
  if (!hz || hz < 70 || hz > 500) return null;
  return Math.min(1, Math.max(0, (Math.log2(hz) - P_LO) / (P_HI - P_LO)));
}

// Waveform history (amplitude bars) with the pitch/tone contour drawn over it.
function WaveTone({
  trace,
  color,
  label,
  toneLabel,
  noDataLabel,
}: {
  trace?: Trace;
  color: string;
  label: string;
  toneLabel: string;
  noDataLabel: string;
}) {
  const peaks = trace?.peaks ?? [];
  const pitch = trace?.pitch ?? [];
  const count = peaks.length || N;

  const lines: string[][] = [];
  let seg: string[] = [];
  pitch.forEach((hz, i) => {
    const nn = normPitch(hz);
    if (nn == null) {
      if (seg.length) lines.push(seg);
      seg = [];
      return;
    }
    seg.push(`${((i + 0.5) / count) * 100},${(1 - nn) * 100}`);
  });
  if (seg.length) lines.push(seg);

  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.08em] text-cream/40">
        <span>{label}</span>
        <span style={{ color }}>{toneLabel}</span>
      </div>
      <div className="relative flex h-12 items-end gap-[2px] rounded-[8px] bg-violet-deep px-2 py-1">
        {peaks.length === 0 && (
          <span className="absolute inset-0 grid place-items-center text-[11px] text-cream/30">
            {noDataLabel}
          </span>
        )}
        {(peaks.length ? peaks : new Array(count).fill(0)).map((p, i) => (
          <span
            key={i}
            className="flex-1 rounded-[1px]"
            style={{ height: `${Math.max(4, p * 100)}%`, background: color, opacity: 0.42 }}
          />
        ))}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {lines.map((pts, i) => (
            <polyline
              key={i}
              points={pts.join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

export default function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const mic = useMic();
  const { t } = useI18n();

  const [upload, setUpload] = useState<Upload | null>(null);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [cur, setCur] = useState(0);
  const [takes, setTakes] = useState<Record<string, RecordResult>>({});
  const [traces, setTraces] = useState<Record<string, { orig?: Trace; mine?: Trace }>>({});
  const [totalMs, setTotalMs] = useState(0);
  const [waveReady, setWaveReady] = useState(false);
  const [finalUrl, setFinalUrl] = useState("");
  const [exportErr, setExportErr] = useState("");
  const [replaying, setReplaying] = useState("");
  const [buffering, setBuffering] = useState(true); // spinner while the video loads/stalls

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const takesRef = useRef<Record<string, RecordResult>>({});
  const origRef = useRef<Pcm | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const capRef = useRef<number | null>(null); // auto-stop timer (sector-length cap)

  // Clear a pending record cap if we unmount mid-recording.
  useEffect(() => () => {
    if (capRef.current != null) clearTimeout(capRef.current);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/creator/jobs");
      const d = (await r.json()) as { uploads: Upload[] };
      const u = d.uploads.find((x) => x.id === id) ?? null;
      setUpload(u);
      const s = (u?.segments ?? []).filter((x) => x.endMs > x.startMs);
      setSegs(s);
      if (s.length) setTotalMs(s[s.length - 1].endMs);
      setPhase(s.length === 0 ? "empty" : "intro");
    })();
  }, [id]);

  // Decode the original audio once for the waveform line + per-sector compare
  // (best-effort; needs CORS on the CDN).
  useEffect(() => {
    if (!upload?.sourceUrl) return;
    (async () => {
      try {
        origRef.current = await decodeBlob(await (await fetch(upload.sourceUrl)).blob());
        setWaveReady(true);
      } catch {
        /* optional — waveform falls back to a flat line */
      }
    })();
  }, [upload?.sourceUrl]);

  // Draw the source waveform onto the canvas under the video.
  const drawWave = useCallback(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const W = (canvas.width = canvas.clientWidth * 2);
    const H = (canvas.height = canvas.clientHeight * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const pcm = origRef.current;
    if (!pcm) {
      ctx.fillStyle = "rgba(255,246,236,0.14)";
      ctx.fillRect(0, H / 2 - 1, W, 2);
      return;
    }
    const data = pcm.data;
    const step = Math.max(1, Math.floor(data.length / W));
    ctx.fillStyle = "rgba(143,212,255,0.5)";
    for (let x = 0; x < W; x++) {
      let peak = 0;
      for (let j = 0; j < step; j++) {
        const v = data[x * step + j];
        if (v) peak = Math.max(peak, Math.abs(v));
      }
      ctx.fillRect(x, (H - Math.max(2, peak * H)) / 2, 1, Math.max(2, peak * H));
    }
  }, []);

  useEffect(() => {
    if (phase === "studio") drawWave();
  }, [phase, waveReady, drawWave]);

  // Move the waveform playhead with the video (no re-render per frame).
  useEffect(() => {
    if (phase !== "studio") return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const ph = playheadRef.current;
      if (v && ph && totalMs > 0) ph.style.left = `${Math.min(100, ((v.currentTime * 1000) / totalMs) * 100)}%`;
      if (stopAtRef.current != null && v && v.currentTime * 1000 >= stopAtRef.current) {
        v.pause();
        stopAtRef.current = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, totalMs]);

  const seg = segs[cur];

  const analyze = useCallback(async (s: Seg, take: RecordResult) => {
    const durMs = s.endMs - s.startMs;
    const orig = origRef.current
      ? trace(
          origRef.current,
          Math.floor((s.startMs / 1000) * origRef.current.rate),
          Math.floor((s.endMs / 1000) * origRef.current.rate),
        )
      : undefined;
    let mine: Trace | undefined;
    try {
      const pcm = await decodeBlob(take.blob);
      const to = Math.min(pcm.data.length, Math.floor((durMs / 1000) * pcm.rate));
      mine = trace(pcm, 0, to);
    } catch {
      /* leave mine undefined */
    }
    setTraces((t) => ({ ...t, [s.id]: { orig, mine } }));
  }, []);

  // --- manual, player-driven actions (nothing runs on its own) ---------------

  const begin = useCallback(async () => {
    await mic.open();
    setCur(0);
    setPhase("studio");
  }, [mic]);

  // Watch/hear the original line once.
  const listen = useCallback(() => {
    const v = videoRef.current;
    if (!v || !seg) return;
    v.muted = false;
    v.currentTime = seg.startMs / 1000;
    stopAtRef.current = seg.endMs;
    void v.play().catch(() => {});
  }, [seg]);

  // Stop the current line's recording (manually or via the sector-length cap).
  const stopRecording = useCallback(async () => {
    if (capRef.current != null) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    const take = await mic.stopRec();
    videoRef.current?.pause();
    stopAtRef.current = null;
    if (seg && take) {
      takesRef.current[seg.id] = take;
      setTakes({ ...takesRef.current });
      await analyze(seg, take);
    }
  }, [seg, mic, analyze]);

  // Start recording this line: play the muted video from the sector start so you
  // can dub to picture. You can't record past the sector length — auto-stop at
  // the sector duration so the take always fits the slot.
  const startRecording = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !seg) return;
    v.muted = true;
    v.currentTime = seg.startMs / 1000;
    await v.play().catch(() => {});
    mic.startRec();
    if (capRef.current != null) clearTimeout(capRef.current);
    const maxMs = Math.max(300, seg.endMs - seg.startMs);
    capRef.current = window.setTimeout(() => void stopRecording(), maxMs);
  }, [seg, mic, stopRecording]);

  const toggleRecord = useCallback(() => {
    if (mic.recording) void stopRecording();
    else void startRecording();
  }, [mic.recording, startRecording, stopRecording]);

  const replayOriginal = useCallback(() => {
    setReplaying("orig");
    listen();
    if (seg) setTimeout(() => setReplaying(""), seg.endMs - seg.startMs);
  }, [listen, seg]);

  const replayMine = useCallback(async () => {
    const v = videoRef.current;
    const take = seg ? takesRef.current[seg.id] : undefined;
    if (!v || !seg || !take) return;
    setReplaying("mine");
    v.muted = true;
    v.currentTime = seg.startMs / 1000;
    stopAtRef.current = seg.endMs;
    const a = new Audio(take.url);
    await Promise.all([v.play().catch(() => {}), a.play().catch(() => {})]);
    setTimeout(() => setReplaying(""), seg.endMs - seg.startMs);
  }, [seg]);

  const goTo = useCallback(
    (i: number) => {
      videoRef.current?.pause();
      stopAtRef.current = null;
      setCur(Math.max(0, Math.min(segs.length - 1, i)));
    },
    [segs.length],
  );

  const exportDub = useCallback(async () => {
    const recorded = Object.entries(takesRef.current);
    if (recorded.length === 0) {
      setExportErr(t("pid.recordLineFirst"));
      setPhase("error");
      return;
    }
    setExportErr("");
    setPhase("exporting");
    try {
      const fd = new FormData();
      fd.append("uploadId", id);
      for (const [segId, take] of recorded) fd.append(`take:${segId}`, take.blob, `${segId}.webm`);
      const r = await fetch("/api/creator/dub", { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).error || t("srun.exportFailed"));
      const d = (await r.json()) as { url: string };
      setFinalUrl(d.url);
      setPhase("done");
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : t("srun.exportFailed"));
      setPhase("error");
    }
  }, [id, t]);

  if (phase === "loading")
    return (
      <main className="g-screen">
        <p className="mt-20 text-cream/60">{t("game.loading")}</p>
      </main>
    );

  if (phase === "empty" || !upload)
    return (
      <main className="g-screen">
        <h1 className="g-logo mt-10">{t("game.noSectors")}</h1>
        <p className="mt-2 text-[14px] text-cream/60">{t("pid.noSectorsBody")}</p>
        <Link href="/play" className="mt-4 text-[13px] text-cream/60 underline">
          {t("game.back")}
        </Link>
      </main>
    );

  const showStudio = phase === "studio";
  const recordedCount = Object.keys(takes).length;
  const hasTake = seg ? !!takes[seg.id] : false;
  const segTrace = seg ? traces[seg.id] : undefined;

  return (
    <main className="g-screen">
      <div className="flex h-[72px] items-center">
        <h1 className="g-logo">{upload.title || t("pid.dub")}</h1>
      </div>

      <div className="w-full max-w-2xl">
        {(phase === "intro" || showStudio) && (
          <div className="g-panel mb-4">
            <div className="relative">
              <video
                ref={videoRef}
                src={upload.sourceUrl}
                playsInline
                preload="auto"
                onLoadStart={() => setBuffering(true)}
                onWaiting={() => setBuffering(true)}
                onStalled={() => setBuffering(true)}
                onSeeking={() => setBuffering(true)}
                onSeeked={() => setBuffering(false)}
                onCanPlay={() => setBuffering(false)}
                onPlaying={() => setBuffering(false)}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (d && isFinite(d)) setTotalMs((prev) => Math.max(prev, Math.round(d * 1000)));
                }}
                className="mx-auto max-h-[42vh] w-full rounded-[10px] bg-black"
              />

              {buffering && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35">
                  <span
                    aria-label={t("editor.loadingVideoAria")}
                    className="h-11 w-11 animate-spin rounded-full border-4 border-cream/25 border-t-mint"
                  />
                </div>
              )}
            </div>

            {/* The audio line under the video: source waveform, sectors, playhead. */}
            <div className="relative mt-3 h-[68px] w-full overflow-hidden rounded-[10px] bg-violet-deep">
              <canvas ref={waveCanvasRef} className="absolute inset-0 h-full w-full" />
              {totalMs > 0 &&
                segs.map((s, i) => (
                  <div
                    key={s.id}
                    onClick={() => showStudio && goTo(i)}
                    className="absolute top-1 bottom-1 rounded-[4px] border"
                    style={{
                      left: `${(s.startMs / totalMs) * 100}%`,
                      width: `${((s.endMs - s.startMs) / totalMs) * 100}%`,
                      borderColor: i === cur ? "#f7941d" : "rgba(255,246,236,0.28)",
                      background:
                        i === cur ? "rgba(255,61,139,0.22)" : "rgba(143,212,255,0.10)",
                      cursor: showStudio ? "pointer" : "default",
                    }}
                  />
                ))}
              <div ref={playheadRef} className="absolute top-0 bottom-0 z-10 w-[2px] bg-sun" style={{ left: "0%" }} />
            </div>
          </div>
        )}

        {phase === "intro" && (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("pid.dubLines", { n: segs.length })}</h2>
            <p className="mb-4 text-[13px] text-cream/60">{t("pid.introBody")}</p>
            <button className="g-btn g-btn-start mx-auto" onClick={() => void begin()}>
              {t("pid.enterStudio")}
            </button>
            {mic.error && <p className="mt-3 text-[13px] text-magenta">{mic.error}</p>}
          </div>
        )}

        {showStudio && seg && (
          <div className="g-panel">
            {/* Line selector */}
            <div className="mb-3 flex items-center justify-between">
              <button
                className="g-btn g-btn-ghost h-8 px-3 text-[13px]"
                disabled={cur === 0 || mic.recording}
                onClick={() => goTo(cur - 1)}
              >
                ◀
              </button>
              <span className="font-display text-[13px] uppercase tracking-[0.1em] text-cream/60">
                {t("pid.lineOf", { a: cur + 1, b: segs.length })} · {fmt(seg.startMs)}–{fmt(seg.endMs)}
                {hasTake && <span className="ml-2 text-mint">{t("pid.recordedTag")}</span>}
              </span>
              <button
                className="g-btn g-btn-ghost h-8 px-3 text-[13px]"
                disabled={cur === segs.length - 1 || mic.recording}
                onClick={() => goTo(cur + 1)}
              >
                ▶
              </button>
            </div>

            <div className="mb-3 rounded-[10px] bg-violet-lift/60 p-3 text-center text-[15px] text-cream">
              &ldquo;{seg.transcript || seg.label}&rdquo;
            </div>

            {/* Manual controls */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                className="g-btn g-btn-ghost h-10 text-[13px]"
                disabled={mic.recording || !!replaying}
                onClick={replayOriginal}
              >
                {replaying === "orig" ? "…" : t("pid.listen")}
              </button>
              <button
                className={`g-btn h-10 text-[13px] ${mic.recording ? "bg-magenta text-cream" : "g-btn-start"}`}
                disabled={!!replaying}
                onClick={() => void toggleRecord()}
              >
                {mic.recording ? t("game.stop") : hasTake ? t("game.reRecord") : t("game.record")}
              </button>
              <button
                className="g-btn g-btn-ghost h-10 text-[13px]"
                disabled={!hasTake || mic.recording || !!replaying}
                onClick={() => void replayMine()}
              >
                {replaying === "mine" ? "…" : t("game.myTake")}
              </button>
              <button
                className="g-btn g-btn-ghost h-10 text-[13px]"
                disabled={cur === segs.length - 1 || mic.recording}
                onClick={() => goTo(cur + 1)}
              >
                {t("pid.nextLine")}
              </button>
            </div>

            {/* Compare: original vs. yours (waveform + tone), shown once recorded */}
            {hasTake && (
              <div className="mt-4 flex flex-col gap-3">
                <WaveTone trace={segTrace?.orig} color="#8FD4FF" label={t("game.original")} toneLabel={t("pid.tone")} noDataLabel={t("pid.noData")} />
                <WaveTone trace={segTrace?.mine} color="#f7941d" label={t("pid.you")} toneLabel={t("pid.tone")} noDataLabel={t("pid.noData")} />
              </div>
            )}

            {/* Finish — you decide when */}
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-cream/10 pt-4">
              <button
                className="g-btn g-btn-start w-full"
                disabled={recordedCount === 0 || mic.recording}
                onClick={() => void exportDub()}
              >
                {t("pid.finishMakeVideo", { a: recordedCount, b: segs.length })}
              </button>
              <Link href="/play" className="text-[13px] text-cream/50 underline">
                {t("pid.backToMedia")}
              </Link>
            </div>
          </div>
        )}

        {phase === "exporting" && <CombineProgress open />}

        {phase === "done" && (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("game.dubReady")}</h2>
            <p className="mb-4 text-[13px] text-cream/60">
              {t("pid.dubReadyBody", { a: recordedCount, b: segs.length })}
            </p>
            {finalUrl && (
              <video
                src={finalUrl}
                controls
                playsInline
                className="mx-auto mb-4 max-h-[60vh] w-full rounded-[10px] bg-black"
              />
            )}
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full flex-wrap items-center gap-3">
                <a
                  href={downloadHref(finalUrl, `${upload?.title || "cinema-dub"}.mp4`)}
                  className="g-btn g-btn-start min-w-[150px] flex-1"
                >
                  {t("game.downloadVideo")}
                </a>
                {finalUrl && (
                  <ShareButton videoUrl={finalUrl} title={upload?.title} mode="solo" />
                )}
              </div>
              <Link href="/dashboard" className="g-btn g-btn-ghost">
                {t("game.backToDashboard")}
              </Link>
              <button className="g-btn g-btn-ghost" onClick={() => setPhase("studio")}>
                {t("game.backToStudio")}
              </button>
              <Link href="/play" className="text-[13px] text-cream/50 underline">
                {t("pid.backToMedia")}
              </Link>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("pid.exportFailedTitle")}</h2>
            <p className="mb-4 text-[13px] text-magenta">{exportErr || t("pid.somethingWrong")}</p>
            <div className="flex flex-col items-center gap-3">
              <button className="g-btn g-btn-start" onClick={() => setPhase("studio")}>
                {t("game.backToStudio")}
              </button>
              <Link href="/play" className="text-[13px] text-cream/50 underline">
                {t("pid.backToMedia")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
