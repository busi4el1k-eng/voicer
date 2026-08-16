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
import { ShareButton } from "@/components/ShareButton";
import { downloadHref } from "@/lib/download";
import { useI18n } from "@/components/LanguageProvider";
import { useRoom } from "@/lib/useRoom";
import { useAppDialog } from "@/components/AppDialog";
import { assignSectors, roleCount, seatsPerRole } from "@/lib/party-assign";

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
  const { t } = useI18n();
  const { dialog, confirm } = useAppDialog();
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
  // The clip must be playable before recording — VideoStage reports this.
  const [videoReady, setVideoReady] = useState(false);
  const [err, setErr] = useState("");
  const [renderBusy, setRenderBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Ratings are mandatory before leaving: pressing "back to dashboard" reveals
  // them, and the exit only unlocks once each required rating is saved.
  const [videoSaved, setVideoSaved] = useState(false);
  const [playersSaved, setPlayersSaved] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // One-time "uneven party" heads-up: explains how sectors were shared out when
  // the party size doesn't match the video's character count. null = no notice.
  const [notice, setNotice] = useState<
    | null
    | { kind: "fewer" | "more"; players: number; roles: number; myRoles: number; share: number }
  >(null);

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

  // Seat universe frozen at launch: [1..seatCount]. Falls back to the live
  // roster size only if the room predates seatCount (0). Used to assign sectors
  // the SAME way here as the server does in submit.
  const seatCount = room ? (room.seatCount > 0 ? room.seatCount : room.players.length) : 0;

  // Load the room's video, then keep only the sectors this seat was assigned.
  // The assignment adapts to the party size (see lib/party-assign): with fewer
  // players than characters a seat covers several roles; with more, a character
  // is split across seats.
  useEffect(() => {
    const uploadId = room?.videoUploadId;
    if (!uploadId || mySeat === 0 || seatCount === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/solo/video/${uploadId}`);
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { video: Video };
        if (cancelled) return;
        setVideo(d.video);

        const seats = Array.from({ length: seatCount }, (_, i) => i + 1);
        const assignment = assignSectors(d.video.segments, seats);
        const mine = d.video.segments.filter((s) => assignment.get(s.id) === mySeat);
        setSegs(mine);
        setPhase(mine.length === 0 ? "empty" : "run");

        // Work out whether the party is uneven, and how it affects ME, so we can
        // show a one-time heads-up. Only when I actually have sectors.
        const roles = roleCount(d.video.segments);
        const myRoleCount = new Set(mine.map((s) => s.player ?? 1)).size;
        if (mine.length > 0 && seatCount !== roles) {
          if (seatCount < roles) {
            setNotice({ kind: "fewer", players: seatCount, roles, myRoles: myRoleCount, share: 0 });
          } else {
            // Largest number of players sharing any character I voice.
            const spr = seatsPerRole(d.video.segments, seats);
            const share = Math.max(1, ...[...new Set(mine.map((s) => s.player ?? 1))].map((r) => spr.get(r) ?? 1));
            setNotice({ kind: "more", players: seatCount, roles, myRoles: myRoleCount, share });
          }
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room?.videoUploadId, mySeat, seatCount]);

  // Same-party rematch: because the host leaving no longer tears the room down,
  // a player can sit on the result screen while the host starts the next game on
  // a new video — this page stays mounted. When the room's video actually
  // changes, wipe the previous round's local state so the fresh game doesn't
  // inherit old takes, waveforms or the rating gate.
  const prevVideoIdRef = useRef<string | null>(null);
  useEffect(() => {
    const vid = room?.videoUploadId ?? null;
    if (vid === prevVideoIdRef.current) return;
    const isRematch = prevVideoIdRef.current !== null && vid !== null;
    prevVideoIdRef.current = vid;
    if (!isRematch) return;
    if (capRef.current != null) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    if (countdownRef.current != null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
    setCur(0);
    takesRef.current = {};
    setTakes({});
    setOrigWave({});
    setTakeWave({});
    setVideoReady(false);
    setErr("");
    setRenderBusy(false);
    setVideoSaved(false);
    setPlayersSaved(false);
    setNotice(null);
  }, [room?.videoUploadId]);

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
  // Ready to record only when the video can play AND this sector's original
  // audio envelope is decoded — until then the Record button shows a loader.
  const sectorReady = videoReady && !!(seg && origWave[seg.id]);

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
      setErr(t("pstud.submitFirst"));
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
      if (!r.ok) throw new Error((await r.json()).error || t("pstud.submitFailed"));
      // `mySubmitted` will flip to true via the room poll; nothing else to do.
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("pstud.submitFailed"));
      setPhase("summary");
    }
  }, [room, playerId, t]);

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
      if (!r.ok) throw new Error((await r.json()).error || t("pstud.renderFailed"));
      // room flips to "finished" + finalUrl via the poll → result shows for all.
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("pstud.renderFailed"));
    } finally {
      setRenderBusy(false);
    }
  }, [room, playerId, t]);

  // Leaving is per-player: whoever taps this just goes to their own dashboard.
  // The host no longer resets the room on the way out, so the party stays
  // "finished" — every other player keeps their result screen and leaves on
  // their own. They're pulled into the next game only when the host actually
  // starts one (the room flips to "playing"/"dubbing"), never dragged to the
  // dashboard just because the host left.
  const backToLobby = useCallback(() => {
    setLeaving(true);
    router.push("/dashboard");
  }, [router]);

  // Hard quit — the always-visible top button. Any player (host OR guest) can
  // end the game for the WHOLE party: it resets the room back to the lobby, so
  // every other player's studio follows to the dashboard via the live stream.
  // Crucially it does NOT tear the room down or drop anyone's membership — the
  // party stays together in the lobby, ready to start another dub. We confirm
  // first because one tap ends the round for everybody.
  const quit = useCallback(async () => {
    const ok = await confirm({
      title: t("pstud.quitTitle"),
      message: t("pstud.quitMsg"),
      confirmLabel: t("pstud.quitConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    setLeaving(true); // stop the guard from redirecting while we end the game
    try {
      await restart("lobby"); // end the game for everyone, keep the room open
    } catch {
      /* even if the reset call fails we still return to the dashboard */
    }
    router.replace("/dashboard");
  }, [confirm, restart, router, t]);

  // --- render ---------------------------------------------------------------

  const recordedCount = Object.keys(takes).length;

  // Always-visible escape hatch: a yellow square pinned to the top-right that
  // lets anyone — host or guest — bail out of the game to the dashboard at any
  // point, in any phase. Rendered on every screen (including the loading state)
  // so a player is never trapped mid-dub.
  const quitButton = (
    <button
      onClick={() => void quit()}
      disabled={leaving}
      title={t("pstud.quit")}
      aria-label={t("pstud.quit")}
      className="fixed right-4 top-4 z-40 flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-[10px] bg-sun font-display text-ink shadow-[0_4px_16px_rgba(0,0,0,0.4)] ring-2 ring-black/10 transition hover:brightness-105 active:scale-95 disabled:opacity-60"
    >
      <span aria-hidden className="text-[16px] font-black leading-none">
        ✕
      </span>
      <span className="text-[9px] font-black uppercase leading-none tracking-[0.06em]">
        {t("pstud.quit")}
      </span>
    </button>
  );

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
            {p.id === playerId && <span className="text-cream/50"> {t("common.you")}</span>}
            {p.isHost && (
              <span className="ml-2 rounded-[6px] bg-sun px-2 py-0.5 font-display text-[10px] font-black uppercase text-ink">
                {t("common.host")}
              </span>
            )}
          </span>
          <span
            className={`font-display text-[12px] font-bold uppercase tracking-[0.06em] ${
              p.status === "finished" ? "text-mint" : "text-sun"
            }`}
          >
            {p.status === "finished" ? t("pstud.finished") : t("pstud.inProgress")}
          </span>
        </div>
      ))}
    </div>
  );

  const title = video?.title || t("pstud.partyDub");

  if (!room || phase === "loading") {
    return (
      <main className="g-screen">
        {quitButton}
        <p className="mt-20 text-cream/60">{t("game.loading")}</p>
        {dialog}
      </main>
    );
  }

  return (
    <main className="g-screen">
      {quitButton}
      <div className="flex h-[72px] items-center pr-16">
        <h1 className="g-logo">{title}</h1>
      </div>

      <div className={`w-full ${isRunView ? "max-w-6xl" : "max-w-2xl"}`}>
        {/* Everyone sees the finished video once the host renders it. */}
        {showResult ? (
          (() => {
            const others = room.players.filter((p) => p.id !== playerId);
            const needVideo = !!room.videoUploadId;
            const needPlayers = others.length > 0;
            const canRate = !!playerId && (needVideo || needPlayers);
            const ratingsDone =
              (!needVideo || videoSaved) && (!needPlayers || playersSaved);
            return (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("pstud.dubReadyTitle")}</h2>
            <p className="mb-4 text-[13px] text-cream/60">{t("pstud.dubReadyBody")}</p>
            <div className="mb-4">
              <VideoStage src={room.finalUrl} />
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full flex-wrap items-center gap-3">
                <a
                  href={downloadHref(room.finalUrl, `${title}.mp4`)}
                  className="g-btn g-btn-start min-w-[150px] flex-1"
                >
                  {t("game.downloadVideo")}
                </a>
                <ShareButton videoUrl={room.finalUrl} title={title} mode="party" />
              </div>
              {/* Ratings are always shown, above the exit. Leaving still waits
                  for them to be done. */}
              {canRate && playerId && (
                <div className="w-full">
                  {needVideo && (
                    <RateVideo
                      uploadId={room.videoUploadId!}
                      raterKey={playerId}
                      onSaved={setVideoSaved}
                    />
                  )}
                  {needPlayers && (
                    <RatePlayers
                      code={room.code}
                      playerId={playerId}
                      players={room.players}
                      onSaved={setPlayersSaved}
                    />
                  )}
                </div>
              )}

              <button
                onClick={() => void backToLobby()}
                disabled={leaving || !ratingsDone}
                className="g-btn g-btn-ghost w-full"
              >
                {leaving ? "…" : t("game.backToDashboard")}
              </button>
              {!ratingsDone && (
                <p className="text-[12px] text-sun">{t("pstud.rateToContinue")}</p>
              )}
            </div>
          </div>
            );
          })()
        ) : phase === "error" ? (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("game.cantLoad")}</h2>
            <p className="mb-4 text-[13px] text-cream/60">
              {t("pstud.videoGone")}
              {isHost ? t("pstud.cantLoadHost") : t("pstud.cantLoadMember")}
            </p>
            <button
              onClick={() => void backToLobby()}
              disabled={leaving}
              className="g-btn g-btn-ghost mx-auto"
            >
              {leaving ? t("pstud.leaving") : t("pstud.leaveParty")}
            </button>
          </div>
        ) : mySubmitted || phase === "submitting" ? (
          // I've finished my sectors — wait for everyone, then the host renders.
          <div className="g-panel">
            <h2 className="g-title">{t("wait.title")}</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              {allFinished
                ? isHost
                  ? t("pstud.allFinishedHost")
                  : t("pstud.allFinishedMember")
                : t("pstud.youreDone")}
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
                    ? t("pstud.rendering")
                    : allFinished
                      ? t("pstud.finishRender")
                      : t("pstud.waitingAll")}
                </button>
              ) : (
                <p className="text-[13px] text-cream/50">{t("pstud.onlyHostRender")}</p>
              )}
              {err && <p className="text-[13px] text-magenta">{err}</p>}
            </div>
          </div>
        ) : phase === "empty" ? (
          <div className="g-panel">
            <h2 className="g-title">{t("pstud.noSectorsForYou")}</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              {t("pstud.noSectorsBody", { n: mySeat })}
            </p>
            {roster}
          </div>
        ) : phase === "summary" ? (
          <div className="g-panel">
            <h2 className="g-title">{t("pstud.yourSectors")}</h2>
            <p className="mb-4 text-center text-[13px] text-cream/60">
              {t("pstud.summaryBody", { a: recordedCount, b: segs.length })}
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
                    {s.transcript || t("editor.sectorN", { n: i + 1 })}
                  </span>
                  <span
                    className={`font-display text-[12px] font-bold uppercase ${
                      takes[s.id] ? "text-mint" : "text-cream/30"
                    }`}
                  >
                    {takes[s.id] ? t("game.recorded") : t("game.skipped")}
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
                {t("pstud.imFinished", { a: recordedCount, b: segs.length })}
              </button>
              {err && <p className="text-[13px] text-magenta">{err}</p>}
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
        ) : (
          // phase === "run"
          seg && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-[14px] font-bold uppercase tracking-[0.1em] text-mint">
                  P{mySeat} · {t("game.sectorOf", { a: cur + 1, b: segs.length })}
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
                        onReadyChange={setVideoReady}
                      />
                      {counting && countdown != null && <ClapperCountdown count={countdown} />}
                    </div>
                    <p className="mt-2 text-center font-display text-[12px] uppercase tracking-[0.08em] text-cream/45">
                      {fmt(seg.startMs)} – {fmt(seg.endMs)} · {t("game.spaceHint")}
                    </p>
                  </div>

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

                  <div className="mt-auto flex items-center justify-between">
                    <button
                      onClick={() => goTo(cur - 1)}
                      disabled={cur === 0 || busy}
                      className="g-btn g-btn-ghost flex h-10 items-center gap-1.5 px-4 text-[13px] disabled:opacity-40"
                    >
                      <span aria-hidden className="text-[15px] leading-none">←</span>
                      {t("game.previousSector")}
                    </button>
                    <button
                      onClick={() => setPhase("summary")}
                      disabled={busy}
                      className="text-[13px] text-cream/50 underline disabled:opacity-40"
                    >
                      {t("game.reviewFinish")}
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

      {/* Uneven-party heads-up — shown once when the party size doesn't match the
          video's character count, explaining how sectors were shared out. */}
      {notice && (
        <div className="g-modal-overlay" onClick={() => setNotice(null)}>
          <div className="g-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-sun/20 text-[24px]">
              🎭
            </div>
            <h3 className="g-modal-title">{t("passign.title")}</h3>
            <p className="g-modal-sub">
              {notice.kind === "fewer"
                ? t("passign.fewerBody", { players: notice.players, roles: notice.roles })
                : t("passign.moreBody", { players: notice.players, roles: notice.roles })}
            </p>
            <p className="mb-4 text-center text-[14px] font-bold text-sun">
              {notice.kind === "fewer"
                ? notice.myRoles > 1
                  ? t("passign.youVoiceMulti", { n: notice.myRoles })
                  : t("passign.youVoiceOne")
                : notice.share > 1
                  ? t("passign.youShare", { n: notice.share })
                  : t("passign.youVoiceOne")}
            </p>
            <button type="button" className="g-btn g-btn-start w-full" onClick={() => setNotice(null)}>
              {t("passign.ok")}
            </button>
          </div>
        </div>
      )}
      {dialog}
    </main>
  );
}
