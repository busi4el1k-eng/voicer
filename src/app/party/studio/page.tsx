"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMic, type RecordResult } from "@/lib/audio/useMic";
import { decodeAudio, type Pcm } from "@/lib/audio/waveform";
import { RecorderWave } from "@/components/RecorderWave";
import { VideoStage, type VideoStageHandle } from "@/components/VideoStage";
import { RatePlayers } from "@/components/RatePlayers";
import { ScenarioWindow, scenarioFromSegments } from "@/components/ScenarioWindow";
import { CombineProgress } from "@/components/CombineProgress";
import { ClapperCountdown } from "@/components/ClapperCountdown";
import { RateVideo } from "@/components/RateVideo";
import { downloadHref } from "@/lib/download";
import { useRoom } from "@/lib/useRoom";

type Seg = {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  transcript: string;
  emotionTag: string;
  player: number;
};
type Video = { id: string; title: string; sourceUrl: string; segments: Seg[] };
// Local phase for the recording portion; the finished/result states are derived
// from the live room so every player's screen stays in sync.
type Phase = "loading" | "run" | "summary" | "submitting" | "empty" | "error";

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export default function PartyStudioPage() {
  const router = useRouter();
  const mic = useMic();
  const { room, playerId, inRoom, isHost, hydrated, restart } = useRoom({
    displayName: "",
    avatarColor: "",
  });

  const [video, setVideo] = useState<Video | null>(null);
  const [segs, setSegs] = useState<Seg[]>([]); // only THIS player's sectors
  const [phase, setPhase] = useState<Phase>("loading");
  const [cur, setCur] = useState(0);
  const [takes, setTakes] = useState<Record<string, RecordResult>>({});
  const [origWave, setOrigWave] = useState<Record<string, Float32Array>>({});
  const [takeWave, setTakeWave] = useState<Record<string, Float32Array>>({});
  const [err, setErr] = useState("");
  const [renderBusy, setRenderBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const stageRef = useRef<VideoStageHandle>(null);
  const pcmRef = useRef<Pcm | null>(null);
  const takesRef = useRef<Record<string, RecordResult>>({});
  const capRef = useRef<number | null>(null); // auto-stop timer (sector-length cap)
  const countdownRef = useRef<number | null>(null); // pre-record 3-2-1 ticker

  const me = room?.players.find((p) => p.id === playerId);
  const mySeat = me?.seat ?? 0;
  const mySubmitted = me?.status === "finished";
  const allFinished = !!room && room.players.length > 0 && room.players.every((p) => p.status === "finished");
  const showResult = room?.status === "finished" && !!room.finalUrl;

  // Guards: you must be in a party, and the game must be underway. If the host
  // hasn't started yet, go back to the pick screen; if you're not in a room,
  // back to the dashboard.
  useEffect(() => {
    if (!hydrated || leaving) return; // wait for storage; skip during our own exit
    if (!inRoom) {
      router.replace("/dashboard");
      return;
    }
    // The host reset the room out from under us: regroup where they went —
    // "lobby" → dashboard waiting room, "playing" → pick-a-video screen.
    if (room && room.status !== "dubbing" && room.status !== "finished") {
      router.replace(room.status === "lobby" ? "/dashboard" : "/party");
    }
  }, [hydrated, inRoom, room, router, leaving]);

  // Load the room's video, then keep only the sectors assigned to my seat.
  useEffect(() => {
    const uploadId = room?.videoUploadId;
    if (!uploadId || mySeat === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/solo/video/${uploadId}`);
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { video: Video };
        if (cancelled) return;
        setVideo(d.video);
        const mine = d.video.segments.filter((s) => s.endMs > s.startMs && (s.player ?? 1) === mySeat);
        setSegs(mine);
        setPhase(mine.length === 0 ? "empty" : "run");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room?.videoUploadId, mySeat]);

  // Decode the source once and precompute each of my sectors' original envelope.
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
    } catch {
      /* keep the recording even if we can't draw its waveform */
    }
  }, [seg, mic]);

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

  // Upload my recorded sectors and mark myself finished. My takes are stored on
  // the server so the host's render can gather everyone's.
  const submitMine = useCallback(async () => {
    const recorded = Object.entries(takesRef.current);
    if (recorded.length === 0 || !room || !playerId) {
      setErr("Record your sectors first.");
      return;
    }
    setErr("");
    setPhase("submitting");
    try {
      const fd = new FormData();
      fd.append("code", room.code);
      fd.append("playerId", playerId);
      for (const [segId, take] of recorded) fd.append(`take:${segId}`, take.blob, `${segId}.webm`);
      const r = await fetch("/api/room/submit", { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).error || "Submit failed.");
      // `mySubmitted` will flip to true via the room poll; nothing else to do.
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit failed.");
      setPhase("summary");
    }
  }, [room, playerId]);

  // Host renders the final combined clip once everyone is finished.
  const renderFinal = useCallback(async () => {
    if (!room || !playerId) return;
    setRenderBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/room/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: room.code, playerId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Render failed.");
      // room flips to "finished" + finalUrl via the poll → result shows for all.
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Render failed.");
    } finally {
      setRenderBusy(false);
    }
  }, [room, playerId]);

  // Host returns to the lobby but KEEPS the party — members stay in the room and
  // will be pulled into the next game. Members just navigate; they never leave
  // the room on their own (only the host controls it).
  const backToLobby = useCallback(async () => {
    setLeaving(true);
    if (isHost) await restart("lobby");
    router.push("/dashboard");
  }, [isHost, restart, router]);

  // --- render ---------------------------------------------------------------

  const recordedCount = Object.keys(takes).length;

  // The active dubbing view (the final `else` branch below) uses a wider,
  // split-screen layout — video on the left, scenario script on the right — so
  // the page container needs to widen to match.
  const isRunView =
    !showResult &&
    phase !== "error" &&
    !mySubmitted &&
    phase !== "submitting" &&
    phase !== "empty" &&
    phase !== "summary" &&
    !!seg;

  // The live player status list — shown while waiting and on the result screen.
  const roster = room && (
    <div className="flex flex-col gap-2">
      {room.players.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-[10px] bg-white/5 px-4 py-3">
          <span
            className="grid h-8 w-8 flex-none place-items-center rounded-[8px] font-display text-[14px] font-black text-white"
            style={{ backgroundColor: p.avatarColor }}
          >
            {p.displayName.charAt(0).toUpperCase()}
          </span>
          <span className="flex-1 truncate font-display text-[14px] font-bold text-cream">
            P{p.seat} · {p.displayName}
            {p.id === playerId && <span className="text-cream/50"> (you)</span>}
            {p.isHost && (
              <span className="ml-2 rounded-[6px] bg-sun px-2 py-0.5 font-display text-[10px] font-black uppercase text-ink">
                Host
              </span>
            )}
          </span>
          <span
            className={`font-display text-[12px] font-bold uppercase tracking-[0.06em] ${
              p.status === "finished" ? "text-mint" : "text-sun"
            }`}
          >
            {p.status === "finished" ? "✓ Finished" : "● In progress"}
          </span>
        </div>
      ))}
    </div>
  );

  const title = video?.title || "Party dub";

  if (!room || phase === "loading") {
    return (
      <main className="g-screen">
        <p className="mt-20 text-cream/60">Loading…</p>
      </main>
    );
  }

  return (
    <main className="g-screen">
      <div className="flex h-[72px] items-center">
        <h1 className="g-logo">{title}</h1>
      </div>

      <div className={`w-full ${isRunView ? "max-w-6xl" : "max-w-2xl"}`}>
        {/* Everyone sees the finished video once the host renders it. */}
        {showResult ? (
          <div className="g-panel text-center">
            <h2 className="g-title">The party dub is ready</h2>
            <p className="mb-4 text-[13px] text-cream/60">
              Everyone&apos;s voices, combined into one clip.
            </p>
            <div className="mb-4">
              <VideoStage src={room.finalUrl} />
            </div>
            <div className="flex flex-col items-center gap-3">
              <a href={downloadHref(room.finalUrl, `${title}.mp4`)} className="g-btn g-btn-start">
                ↓ Download video
              </a>
              <button
                onClick={() => void backToLobby()}
                disabled={leaving}
                className="g-btn g-btn-ghost w-full"
              >
                {leaving ? "…" : "← Back to dashboard"}
              </button>
              {playerId && (
                <button
                  onClick={() => setShowRating((v) => !v)}
                  className="g-btn g-btn-primary w-full"
                >
                  {showRating ? "Hide ratings" : "★ Rate video & cast"}
                </button>
              )}
            </div>

            {showRating && playerId && (
              <>
                {room.videoUploadId && (
                  <RateVideo uploadId={room.videoUploadId} raterKey={playerId} />
                )}
                <RatePlayers code={room.code} playerId={playerId} players={room.players} />
              </>
            )}
          </div>
        ) : phase === "error" ? (
          <div className="g-panel text-center">
            <h2 className="g-title">Couldn&apos;t load</h2>
            <p className="mb-4 text-[13px] text-cream/60">
              The party video isn&apos;t available anymore
              {isHost
                ? " — it may have been deleted. Leave and set up the party again."
                : ". Leaving the party — the host will need to pick another video."}
            </p>
            <button
              onClick={() => void backToLobby()}
              disabled={leaving}
              className="g-btn g-btn-ghost mx-auto"
            >
              {leaving ? "Leaving…" : "Leave party"}
            </button>
          </div>
        ) : mySubmitted || phase === "submitting" ? (
          // I've finished my sectors — wait for everyone, then the host renders.
          <div className="g-panel">
            <h2 className="g-title">Waiting room</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              {allFinished
                ? isHost
                  ? "Everyone's finished — render the final clip."
                  : "Everyone's finished — waiting for the host to render."
                : "You're done. Waiting for the rest of the party to finish their sectors."}
            </p>
            {roster}
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-cream/10 pt-4">
              {isHost ? (
                <button
                  className="g-btn g-btn-start w-full"
                  disabled={!allFinished || renderBusy}
                  onClick={() => void renderFinal()}
                >
                  {renderBusy
                    ? "Rendering…"
                    : allFinished
                      ? "Finish & render →"
                      : "Waiting for all players…"}
                </button>
              ) : (
                <p className="text-[13px] text-cream/50">Only the host can render the final clip.</p>
              )}
              {err && <p className="text-[13px] text-magenta">{err}</p>}
            </div>
          </div>
        ) : phase === "empty" ? (
          <div className="g-panel">
            <h2 className="g-title">No sectors for you</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              This video has no sectors assigned to player {mySeat}. You can still wait for the
              others to finish.
            </p>
            {roster}
          </div>
        ) : phase === "summary" ? (
          <div className="g-panel">
            <h2 className="g-title">Your sectors</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              {recordedCount} of {segs.length} recorded. Submit when you&apos;re happy — the host
              renders once everyone&apos;s done.
            </p>
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
                    {s.transcript || `Sector ${i + 1}`}
                  </span>
                  <span
                    className={`font-display text-[12px] font-bold uppercase ${
                      takes[s.id] ? "text-mint" : "text-cream/30"
                    }`}
                  >
                    {takes[s.id] ? "● Recorded" : "— Skipped"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-cream/10 pt-4">
              <button
                className="g-btn g-btn-start w-full"
                disabled={recordedCount === 0}
                onClick={() => void submitMine()}
              >
                I&apos;m finished ({recordedCount}/{segs.length})
              </button>
              {err && <p className="text-[13px] text-magenta">{err}</p>}
              <button
                onClick={() => {
                  setPhase("run");
                  setCur(0);
                }}
                className="text-[13px] text-cream/50 underline"
              >
                ◀ Back to sectors
              </button>
            </div>
          </div>
        ) : (
          // phase === "run"
          seg && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-[14px] font-bold uppercase tracking-[0.1em] text-mint">
                  P{mySeat} · Sector {cur + 1} / {segs.length}
                </span>
                <div className="flex flex-1 gap-1 pl-4">
                  {segs.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => goTo(i)}
                      disabled={busy}
                      title={`Sector ${i + 1}`}
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

              {/* Split screen: video + your recorder on the left, the scenario
                  script on the right. Stacks on small screens. */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
                {/* Left — the current sector's video player and recorder. */}
                <div className="flex flex-col">
                  <div className="g-panel mb-4">
                    <div className="relative">
                      <VideoStage
                        ref={stageRef}
                        src={video?.sourceUrl}
                        sector={{ startMs: seg.startMs, endMs: seg.endMs }}
                      />
                      {counting && countdown != null && <ClapperCountdown count={countdown} />}
                    </div>
                    <p className="mt-2 text-center font-display text-[12px] uppercase tracking-[0.08em] text-cream/45">
                      {fmt(seg.startMs)} – {fmt(seg.endMs)} · space = play / pause
                    </p>
                  </div>

                  <div className="g-panel mb-4">
                    <div className="mb-2 flex justify-between text-[11px] font-bold uppercase tracking-[0.08em]">
                      <span className="text-sky-400">Original</span>
                      <span className="text-red-400">Your voice</span>
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
                        className={`g-btn h-11 text-[14px] ${
                          mic.recording || counting ? "bg-magenta text-cream" : "g-btn-start"
                        }`}
                      >
                        {mic.recording
                          ? "■ Stop"
                          : counting
                            ? `Starting in ${countdown}…`
                            : takes[seg.id]
                              ? "● Re-record"
                              : "● Record"}
                      </button>
                      <button
                        onClick={playMyTake}
                        disabled={!takes[seg.id] || busy}
                        className="g-btn g-btn-ghost h-11 text-[14px]"
                      >
                        ▶ My take
                      </button>
                      <button
                        onClick={next}
                        disabled={busy}
                        className="g-btn g-btn-primary col-span-2 h-11 text-[14px] sm:col-span-1"
                      >
                        {cur >= segs.length - 1 ? "Finish sectors →" : "Next sector →"}
                      </button>
                    </div>
                    {mic.error && <p className="mt-3 text-[13px] text-magenta">{mic.error}</p>}
                  </div>

                  <div className="mt-auto flex items-center justify-between">
                    <button
                      onClick={() => goTo(cur - 1)}
                      disabled={cur === 0 || busy}
                      className="text-[13px] text-cream/50 underline disabled:opacity-40"
                    >
                      ◀ Previous sector
                    </button>
                    <button
                      onClick={() => setPhase("summary")}
                      disabled={busy}
                      className="text-[13px] text-cream/50 underline disabled:opacity-40"
                    >
                      Review &amp; finish
                    </button>
                  </div>
                </div>

                {/* Right — the scene's real script; the current line is highlighted
                    and doubles as your "what to say" cue. Fills the column height
                    (absolute on lg) so it never grows taller than the recorder. */}
                <div className="relative min-h-0">
                  <div className="lg:absolute lg:inset-0">
                    <ScenarioWindow
                      mySeat={mySeat}
                      lines={scenarioFromSegments(video?.segments ?? [])}
                      currentKey={seg.id}
                    />
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
      <CombineProgress open={renderBusy} />
    </main>
  );
}
