"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { downloadHref } from "@/lib/download";
import { useMic, type RecordResult } from "@/lib/audio/useMic";
import { decodeAudio, type Pcm } from "@/lib/audio/waveform";
import { sectorMatch } from "@/lib/audio/similarity";
import { RecorderWave } from "@/components/RecorderWave";
import { VideoStage, type VideoStageHandle } from "@/components/VideoStage";
import { RateVideo } from "@/components/RateVideo";
import { ShareButton } from "@/components/ShareButton";
import { ScenarioWindow, scenarioFromSegments } from "@/components/ScenarioWindow";
import { CombineProgress } from "@/components/CombineProgress";
import { ClapperCountdown } from "@/components/ClapperCountdown";
import { useI18n } from "@/components/LanguageProvider";
import { useAppDialog } from "@/components/AppDialog";
import { getClientId } from "@/lib/client-id";

type Seg = {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  transcript: string;
  emotionTag: string;
};
type Video = { id: string; title: string; sourceUrl: string; segments: Seg[] };
type Phase = "loading" | "run" | "summary" | "exporting" | "result" | "empty" | "error";

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

// Colour a match % — mint (great) → sun (ok) → pink (needs work).
const matchColor = (pct: number) =>
  pct >= 70 ? "#27E1A1" : pct >= 40 ? "#FFD23F" : "#FF6FA5";

export default function SoloRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const mic = useMic();
  const { t } = useI18n();
  const { dialog, confirm } = useAppDialog();
  const router = useRouter();

  const [video, setVideo] = useState<Video | null>(null);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [cur, setCur] = useState(0);
  const [takes, setTakes] = useState<Record<string, RecordResult>>({});
  const [origWave, setOrigWave] = useState<Record<string, Float32Array>>({});
  const [takeWave, setTakeWave] = useState<Record<string, Float32Array>>({});
  // Per-sector "match with original" %, scored on-device from the two envelopes
  // the moment a take is recorded (see stopRecording). No upload, no server.
  const [scores, setScores] = useState<Record<string, number>>({});
  // The clip must be playable before recording — VideoStage reports this.
  const [videoReady, setVideoReady] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [exportErr, setExportErr] = useState("");
  // Per-browser id so a solo player's video rating sticks to them. Lazily read
  // (client-only) — it isn't rendered until the result screen, so there's no
  // hydration mismatch from the empty server value.
  const [clientId] = useState(() => (typeof window !== "undefined" ? getClientId() : ""));

  const [countdown, setCountdown] = useState<number | null>(null);
  // Rating is mandatory before leaving: pressing "back to dashboard" reveals it,
  // and the exit only unlocks once the video score is saved.
  const [videoSaved, setVideoSaved] = useState(false);

  const stageRef = useRef<VideoStageHandle>(null);
  const pcmRef = useRef<Pcm | null>(null);
  const takesRef = useRef<Record<string, RecordResult>>({});
  const capRef = useRef<number | null>(null); // auto-stop timer (sector-length cap)
  const countdownRef = useRef<number | null>(null); // pre-record 3-2-1 ticker

  // Load the shared video + its sectors.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/solo/video/${id}`);
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { video: Video };
        setVideo(d.video);
        const s = d.video.segments.filter((x) => x.endMs > x.startMs);
        setSegs(s);
        setPhase(s.length === 0 ? "empty" : "run");
      } catch {
        setPhase("error");
      }
    })();
  }, [id]);

  // Decode the source audio once and precompute each sector's original envelope.
  useEffect(() => {
    if (!video?.sourceUrl || segs.length === 0) return;
    (async () => {
      try {
        const pcm = await decodeAudio(video.sourceUrl);
        pcmRef.current = pcm;
        const map: Record<string, Float32Array> = {};
        for (const s of segs) {
          const from = Math.floor((s.startMs / 1000) * pcm.rate);
          const to = Math.floor((s.endMs / 1000) * pcm.rate);
          map[s.id] = pcm.data.subarray(from, to);
        }
        setOrigWave(map);
      } catch {
        /* original waveform is best-effort (needs CORS) */
      }
    })();
  }, [video?.sourceUrl, segs]);

  // Clear any pending record cap / countdown if we unmount mid-recording.
  useEffect(() => {
    return () => {
      if (capRef.current != null) clearTimeout(capRef.current);
      if (countdownRef.current != null) clearInterval(countdownRef.current);
    };
  }, []);

  const seg = segs[cur];
  // Ready to record as soon as the video can play. The original-audio waveform
  // (origWave) is a best-effort scoring overlay decoded in the background — it
  // must NEVER gate recording, or a slow/failed decode hangs the scene forever.
  const sectorReady = videoReady && !!seg;


  const stopRecording = useCallback(async () => {
    if (capRef.current != null) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    if (!seg) return;
    const take = await mic.stopRec();
    if (!take) return;
    takesRef.current[seg.id] = take;
    setTakes({ ...takesRef.current });
    try {
      const pcm = await decodeAudio(take.blob);
      setTakeWave((p) => ({ ...p, [seg.id]: pcm.data }));
      // Score this take against the original sector envelope on-device.
      const orig = origWave[seg.id];
      if (orig) setScores((p) => ({ ...p, [seg.id]: sectorMatch(orig, pcm.data) }));
    } catch {
      /* keep the recording even if we can't draw its waveform */
    }
  }, [seg, mic, origWave]);

  // You can't record longer than the sector runs: auto-stop at the sector
  // length. Anything you leave unfilled stays silent in the final mix (the
  // original audio is muted across the whole sector).
  const startRecording = useCallback(async () => {
    if (!seg) return;
    if (!mic.ready) await mic.open();
    mic.startRec();
    if (capRef.current != null) clearTimeout(capRef.current);
    const maxMs = Math.max(300, seg.endMs - seg.startMs);
    capRef.current = window.setTimeout(() => void stopRecording(), maxMs);
  }, [seg, mic, stopRecording]);

  // Give players a moment to react: a 3-2-1 countdown before recording opens.
  // Warm up the mic during the count so capture starts the instant it hits 0.
  const beginCountdown = useCallback(() => {
    if (!seg || countdownRef.current != null || mic.recording) return;
    if (!mic.ready) void mic.open();
    let n = 3;
    setCountdown(n);
    countdownRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownRef.current != null) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        setCountdown(null);
        void startRecording();
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [seg, mic, startRecording]);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current != null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }, []);

  const counting = countdown != null;
  const busy = mic.recording || counting;

  const playMyTake = useCallback(() => {
    const take = seg ? takesRef.current[seg.id] : undefined;
    if (!take) return;
    void new Audio(take.url).play().catch(() => {});
  }, [seg]);

  const stopVideo = () => stageRef.current?.stop();

  const goTo = useCallback(
    (i: number) => {
      stopVideo();
      setCur(Math.max(0, Math.min(segs.length - 1, i)));
    },
    [segs.length],
  );

  const next = () => {
    if (mic.recording || countdownRef.current != null) return;
    stopVideo();
    if (cur >= segs.length - 1) setPhase("summary");
    else setCur(cur + 1);
  };

  // Combine every recorded sector back into the full-length video (the backend
  // replaces the original audio inside each dubbed sector) and show the result.
  const finish = useCallback(async () => {
    const recorded = Object.entries(takesRef.current);
    if (recorded.length === 0) {
      setExportErr(t("srun.recordFirst"));
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
      setResultUrl(d.url);
      setPhase("result");
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : t("srun.exportFailed"));
      setPhase("summary");
    }
  }, [id, t]);

  // Always-visible quit — the same yellow square as party mode. Solo has no room
  // to tear down, so it just leaves to the dashboard; we confirm first when
  // there are unsaved recordings so an accidental tap doesn't lose them.
  const quit = useCallback(async () => {
    const hasWork = Object.keys(takesRef.current).length > 0 && phase !== "result";
    if (hasWork) {
      const ok = await confirm({
        title: t("srun.quitTitle"),
        message: t("srun.quitMsg"),
        confirmLabel: t("srun.quitConfirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    router.push("/dashboard");
  }, [confirm, phase, router, t]);

  // The yellow Quit square, pinned top-right on every screen (matches party mode).
  const quitButton = (
    <button
      onClick={() => void quit()}
      title={t("pstud.quit")}
      aria-label={t("pstud.quit")}
      className="fixed right-4 top-4 z-40 flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-[10px] bg-sun font-display text-ink shadow-[0_4px_16px_rgba(0,0,0,0.4)] ring-2 ring-black/10 transition hover:brightness-105 active:scale-95"
    >
      <span aria-hidden className="text-[16px] font-black leading-none">
        ✕
      </span>
      <span className="text-[9px] font-black uppercase leading-none tracking-[0.06em]">
        {t("pstud.quit")}
      </span>
    </button>
  );

  // --- render ---------------------------------------------------------------

  if (phase === "loading") {
    return (
      <main className="g-screen">
        <p className="mt-20 text-cream/60">{t("game.loading")}</p>
      </main>
    );
  }

  if (phase === "error" || !video) {
    return (
      <main className="g-screen">
        <h1 className="g-logo mt-10">{t("game.cantLoad")}</h1>
        <p className="mt-2 text-[14px] text-cream/60">{t("srun.notAvailable")}</p>
        <Link href="/play" className="mt-4 text-[13px] text-cream/60 underline">
          {t("game.back")}
        </Link>
      </main>
    );
  }

  if (phase === "empty") {
    return (
      <main className="g-screen">
        <h1 className="g-logo mt-10">{t("game.noSectors")}</h1>
        <p className="mt-2 text-[14px] text-cream/60">{t("srun.noSectorsBody")}</p>
        <Link href="/play" className="mt-4 text-[13px] text-cream/60 underline">
          {t("game.back")}
        </Link>
      </main>
    );
  }

  const recordedCount = Object.keys(takes).length;

  // Average match across the recorded sectors, for the summary headline.
  const matchVals = segs.filter((s) => takes[s.id]).map((s) => scores[s.id] ?? 0);
  const overallMatch = matchVals.length
    ? Math.round(matchVals.reduce((a, b) => a + b, 0) / matchVals.length)
    : 0;

  // The active dubbing view uses a wider, split-screen layout (video on the
  // left, scenario script on the right), so the page container widens to match.
  const isRunView = phase === "run" && !!seg;

  return (
    <main className="g-screen">
      {quitButton}
      <div className="flex h-[72px] items-center pr-16">
        <h1 className="g-logo">{video.title || t("solo.title")}</h1>
      </div>

      <div className={`w-full ${isRunView ? "max-w-6xl" : "max-w-2xl"}`}>
        {phase === "run" && seg && (
          <>
            {/* Progress */}
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[14px] font-bold uppercase tracking-[0.1em] text-mint">
                {t("game.sectorOf", { a: cur + 1, b: segs.length })}
              </span>
              <div className="flex flex-1 gap-1 pl-4">
                {segs.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => goTo(i)}
                    disabled={busy}
                    title={t("editor.sectorN", { n: i + 1 })}
                    className="h-2 flex-1 rounded-full transition-colors"
                    style={{
                      background:
                        i === cur
                          ? "#FF3D8B"
                          : takes[s.id]
                            ? "#27E1A1"
                            : "rgba(255,246,236,0.18)",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Split screen: video + recorder on the left, scenario script on
                the right. Stacks on small screens. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
              {/* Left — the current sector's video player and recorder. */}
              <div className="flex flex-col">
                {/* Video — app-styled player, restricted to just this sector */}
                <div className="g-panel mb-4">
                  <div className="relative">
                    <VideoStage
                      ref={stageRef}
                      src={video.sourceUrl}
                      sector={{ startMs: seg.startMs, endMs: seg.endMs }}
                      onReadyChange={setVideoReady}
                    />
                    {counting && countdown != null && <ClapperCountdown count={countdown} />}
                  </div>
                  <p className="mt-2 text-center font-display text-[12px] uppercase tracking-[0.08em] text-cream/45">
                    {fmt(seg.startMs)} – {fmt(seg.endMs)} · {t("game.spaceHint")}
                  </p>
                </div>

                {/* Recorder + voice waveform over the original */}
                <div className="g-panel mb-4">
                  <div className="mb-2 flex justify-between text-[11px] font-bold uppercase tracking-[0.08em]">
                    <span className="text-sky-400">{t("game.original")}</span>
                    <span className="text-red-400">{t("game.yourVoice")}</span>
                  </div>
                  <RecorderWave
                    original={origWave[seg.id]}
                    take={takeWave[seg.id]}
                    recording={mic.recording}
                    getLevel={mic.getLevel}
                    durationMs={seg.endMs - seg.startMs}
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <button
                      onClick={() =>
                        mic.recording
                          ? void stopRecording()
                          : counting
                            ? cancelCountdown()
                            : beginCountdown()
                      }
                      disabled={!sectorReady && !mic.recording && !counting}
                      className={`g-btn h-11 text-[14px] disabled:opacity-60 ${
                        mic.recording || counting ? "bg-magenta text-cream" : "g-btn-start"
                      }`}
                    >
                      {!sectorReady && !mic.recording && !counting
                        ? t("game.loadingScene")
                        : mic.recording
                          ? t("game.stop")
                          : counting
                            ? t("game.startingIn", { n: countdown ?? "" })
                            : takes[seg.id]
                              ? t("game.reRecord")
                              : t("game.record")}
                    </button>
                    <button
                      onClick={playMyTake}
                      disabled={!takes[seg.id] || busy}
                      className="g-btn g-btn-ghost h-11 text-[14px]"
                    >
                      {t("game.myTake")}
                    </button>
                    <button
                      onClick={next}
                      disabled={busy}
                      className="g-btn g-btn-primary col-span-2 h-11 text-[14px] sm:col-span-1"
                    >
                      {cur >= segs.length - 1 ? t("game.finishSectors") : t("game.nextSector")}
                    </button>
                  </div>
                  {mic.error && <p className="mt-3 text-[13px] text-magenta">{mic.error}</p>}
                </div>

                <div className="mt-auto flex items-center">
                  <button
                    onClick={() => goTo(cur - 1)}
                    disabled={cur === 0 || busy}
                    className="g-btn g-btn-ghost flex h-10 items-center gap-1.5 px-4 text-[13px] disabled:opacity-40"
                  >
                    <span aria-hidden className="text-[15px] leading-none">←</span>
                    {t("game.previousSector")}
                  </button>
                </div>
              </div>

              {/* Right — the scene's real script; the current line is highlighted
                  and doubles as your "what to say" cue. Fills the column height
                  (absolute on lg) so it never grows taller than the recorder. */}
              <div className="relative min-h-0">
                <div className="lg:absolute lg:inset-0">
                  <ScenarioWindow
                    mySeat={1}
                    lines={scenarioFromSegments(segs)}
                    currentKey={seg.id}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {phase === "summary" && (
          <div className="g-panel">
            <h2 className="g-title">{t("srun.allDone")}</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              {t("srun.recordedOf", { a: recordedCount, b: segs.length })}
            </p>

            {/* Overall "match with original" — the average of the recorded
                sectors' on-device scores. */}
            {recordedCount > 0 && (
              <div className="mb-4 flex flex-col items-center gap-1 rounded-[12px] bg-white/5 py-4">
                <span className="font-display text-[44px] font-black leading-none" style={{ color: matchColor(overallMatch) }}>
                  {overallMatch}%
                </span>
                <span className="font-display text-[12px] font-bold uppercase tracking-[0.1em] text-cream/70">
                  {t("srun.matchOverall")}
                </span>
                <p className="mt-1 max-w-sm px-4 text-center text-[11px] leading-snug text-cream/45">
                  {t("srun.matchHint")}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {segs.map((s, i) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-[10px] bg-white/5 px-4 py-3"
                >
                  <span className="font-display text-[13px] font-bold text-cream/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate text-[14px] text-cream">
                    {s.transcript || t("editor.sectorN", { n: i + 1 })}
                  </span>
                  <span className="font-display text-[12px] uppercase tracking-[0.08em] text-cream/45">
                    {fmt(s.startMs)}–{fmt(s.endMs)}
                  </span>
                  {takes[s.id] ? (
                    <span className="flex items-baseline gap-1">
                      <span
                        className="font-display text-[16px] font-black"
                        style={{ color: matchColor(scores[s.id] ?? 0) }}
                      >
                        {scores[s.id] ?? 0}%
                      </span>
                      <span className="font-display text-[10px] uppercase tracking-[0.08em] text-cream/40">
                        {t("srun.matchSector")}
                      </span>
                    </span>
                  ) : (
                    <span className="font-display text-[12px] font-bold uppercase text-cream/30">
                      {t("game.skipped")}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col items-center gap-2 border-t border-cream/10 pt-4">
              <button
                className="g-btn g-btn-start w-full"
                disabled={recordedCount === 0}
                onClick={() => void finish()}
              >
                {t("srun.finishCombine", { a: recordedCount, b: segs.length })}
              </button>
              {exportErr && <p className="text-[13px] text-magenta">{exportErr}</p>}
              <button
                onClick={() => {
                  setPhase("run");
                  setCur(0);
                }}
                className="text-[13px] text-cream/50 underline"
              >
                {t("game.backToSectors")}
              </button>
            </div>
          </div>
        )}

        {phase === "exporting" && <CombineProgress open />}

        {phase === "result" && (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("game.dubReady")}</h2>
            <p className="mb-4 text-[13px] text-cream/60">
              {t("srun.dubReadyBody", { a: recordedCount, b: segs.length })}
            </p>
            {resultUrl && (
              <div className="mb-4">
                <VideoStage src={resultUrl} />
              </div>
            )}

            {/* Your match with the original, carried over from the run. */}
            {recordedCount > 0 && (
              <div className="mb-4 flex flex-col items-center gap-1 rounded-[12px] bg-white/5 py-4">
                <span
                  className="font-display text-[44px] font-black leading-none"
                  style={{ color: matchColor(overallMatch) }}
                >
                  {overallMatch}%
                </span>
                <span className="font-display text-[12px] font-bold uppercase tracking-[0.1em] text-cream/70">
                  {t("srun.matchOverall")}
                </span>
              </div>
            )}
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full flex-wrap items-center gap-3">
                <a
                  href={downloadHref(resultUrl, `${video?.title || "cinema-dub"}.mp4`)}
                  className="g-btn g-btn-start min-w-[150px] flex-1"
                >
                  {t("game.downloadVideo")}
                </a>
                {resultUrl && (
                  <ShareButton videoUrl={resultUrl} title={video?.title} mode="solo" />
                )}
              </div>
              {/* Rating is always shown, above the exit. Leaving still waits for
                  the score to be saved. */}
              {video && clientId && (
                <div className="w-full">
                  <RateVideo uploadId={video.id} raterKey={clientId} onSaved={setVideoSaved} />
                </div>
              )}

              <button
                onClick={() => router.push("/dashboard")}
                disabled={!!(video && clientId) && !videoSaved}
                className="g-btn g-btn-ghost w-full"
              >
                {t("game.backToDashboard")}
              </button>
              {video && clientId && !videoSaved && (
                <p className="text-[12px] text-sun">{t("srun.rateToContinue")}</p>
              )}
            </div>
          </div>
        )}
      </div>
      {dialog}
    </main>
  );
}
