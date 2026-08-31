"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountBar } from "@/components/AccountBar";
import { VideoStage } from "@/components/VideoStage";
import { useI18n } from "@/components/LanguageProvider";
import { formatShareId, formatShareInput } from "@/lib/share-id";
import { useRoom } from "@/lib/useRoom";
import { RoleAssignPanel } from "@/components/RoleAssignPanel";

type Video = {
  id: string;
  title: string;
  shareId: string | null;
  status: string;
  sourceUrl: string;
  durationMs: number;
  lines: number;
  players: number; // recommended players = distinct seats the creator assigned
};

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

export default function PartyHome() {
  const router = useRouter();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  // Mode requested via ?mode=duel (e.g. from the library chooser). Overrides the
  // room's current mode when the host launches; null = keep the room as-is.
  const [intendedMode, setIntendedMode] = useState<"party" | "duel" | null>(null);
  // True when we landed here from the library with a video already chosen
  // (?code=…). In that case the code-search bar is pointless, so we hide it.
  const [fromLibrary, setFromLibrary] = useState(false);

  // The invite-lobby room the user is in (created from the dashboard, persisted
  // in localStorage + polled). Read here only, to show the live party size.
  const { room, playerId, inRoom, isHost, leave, setRoles } = useRoom({ displayName: "", avatarColor: "" });
  // Only the host chooses the video; every other member waits. `inRoom`/`isHost`
  // are optimistic (from the stored membership) so the waiting view shows
  // instantly, before the room fetch resolves.
  const isMember = inRoom && !isHost;
  const isDuel = intendedMode === "duel" || (intendedMode == null && room?.mode === "duel");
  const partyCount = room ? room.players.length : null;
  // Whether the party size matches the video's recommended (creator-cast) count.
  // Any size is now allowed to play — the studio shares sectors out to fit — so
  // this only drives the soft colour hint and the heads-up note, not a hard gate.
  const partyMatches = !!video && partyCount !== null && partyCount === video.players;
  const inParty = partyCount !== null && partyCount >= 1;
  // Show the "cast the roles" left window once the host has found a video and
  // gathered a party. Members see the waiting view instead, so it's host-side.
  const showAssign = !isMember && !!video && inParty;

  // Once the host launches (room flips to "dubbing"), the host and every waiting
  // member follow into the studio together. Also covers "finished" so a late
  // poll still routes correctly.
  useEffect(() => {
    if (room?.status === "dubbing") router.push("/party/studio");
    // Host reset the party back to the lobby → members regroup on the dashboard.
    else if (isMember && room?.status === "lobby") router.push("/dashboard");
  }, [room?.status, isMember, router]);

  // Host locks in the found video and starts the game for the whole party.
  const startForEveryone = async () => {
    if (!video || !room || !playerId) return;
    setLaunching(true);
    setErr("");
    try {
      const r = await fetch("/api/room/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: room.code,
          playerId,
          uploadId: video.id,
          // When arriving from the library's Duel/Party chooser, set the room's
          // mode at launch. Omitted otherwise so the dashboard-chosen mode stands.
          ...(intendedMode ? { mode: intendedMode } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("ppick.cantStart"));
      router.push("/party/studio");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ppick.cantStart"));
      setLaunching(false);
    }
  };

  const search = async (override?: string) => {
    const trimmed = (override ?? code).trim();
    if (!trimmed) return setErr(t("solo.enterShareCode"));
    setBusy(true);
    setErr("");
    setVideo(null);
    try {
      const r = await fetch(`/api/solo/lookup?code=${encodeURIComponent(trimmed)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("solo.lookupFailed"));
      const found = d.video as Video;
      // A different video has different characters, so any casting saved for the
      // previous one is stale — drop back to the automatic default for the new
      // video. Only fires when there's actually an override to clear.
      if (found.id !== video?.id && room?.roleAssign) void setRoles(null);
      setVideo(found);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("solo.lookupFailed"));
    } finally {
      setBusy(false);
    }
  };

  // A code handed off from the Video library ("Party mode") pre-fills the search
  // and looks the video up automatically, so the host lands right on it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    if (m === "duel" || m === "party") setIntendedMode(m);
    const c = params.get("code");
    if (!c) return;
    setFromLibrary(true);
    void (async () => {
      const pretty = formatShareInput(c);
      setCode(pretty);
      await search(pretty);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>
      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          {isDuel ? "Duel" : "Party"}
          <em>Dub</em>
        </h1>
      </div>

      <div className="w-full">
        <div className={showAssign ? "g-center items-start" : "mx-auto w-full max-w-xl"}>
          {showAssign && video && (
            <RoleAssignPanel
              videoId={video.id}
              players={room?.players ?? []}
              isHost={isHost}
              myId={playerId}
              isDuel={isDuel}
              roleAssign={room?.roleAssign ?? null}
              onSave={setRoles}
            />
          )}
          <div className={showAssign ? "g-right" : ""}>
            <div className={showAssign ? "mx-auto w-full max-w-xl" : ""}>
        {isMember ? (
          // Non-host members wait — the host picks the video for everyone.
          // Renders instantly from the membership hint; the roster fills in
          // once the room loads.
          <>
            <h2 className="g-title">{t("wait.title")}</h2>
            <div className="g-panel">
              <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
                ⏳
              </div>
              <p className="text-center text-[14px] leading-[1.5] text-cream">
                <b>{room?.players.find((p) => p.isHost)?.displayName ?? t("ppick.theHost")}</b>{" "}
                {t("ppick.choosingTail")}
              </p>
              <p className="mt-2 text-center font-display text-[11px] font-bold uppercase tracking-[0.05em] text-cream/50">
                {room ? t("ppick.inYourParty", { n: room.players.length }) : t("wait.connecting")}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {(room?.players ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-[10px] bg-white/5 px-3 py-2"
                  >
                    <span
                      className="grid h-8 w-8 flex-none place-items-center rounded-[8px] font-display text-[14px] font-black text-white"
                      style={{ backgroundColor: p.avatarColor }}
                    >
                      {p.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 font-display text-[14px] font-bold text-cream">
                      {p.displayName}
                      {p.id === playerId && <span className="text-cream/50"> {t("common.you")}</span>}
                    </span>
                    {p.isHost && (
                      <span className="rounded-[6px] bg-sun px-2 py-0.5 font-display text-[10px] font-black uppercase text-ink">
                        {t("common.host")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="g-btn g-btn-ghost mt-4 w-full"
                onClick={() => {
                  void leave();
                }}
              >
                {t("common.leaveRoom")}
              </button>
            </div>
          </>
        ) : (
          <>
        {!fromLibrary && (
          <>
        <h2 className="g-title">{t("ppick.findVideo")}</h2>

        {/* Code search — hidden when the video was opened from the library. */}
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
            <button onClick={() => void search()} disabled={busy} className="g-btn g-btn-primary px-5">
              {busy ? "…" : t("solo.search")}
            </button>
          </div>
          {err && <p className="mt-3 text-[13px] text-magenta">{err}</p>}
          <p className="mt-3 text-[12px] leading-[1.5] text-cream/50">{t("ppick.hint")}</p>

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
          </>
        )}

        {/* From the library with no search bar to fall back on: surface the
            lookup state (loading / error) until the video resolves. */}
        {fromLibrary && !video && (
          <div className="g-panel text-center">
            {err ? (
              <p className="text-[14px] text-magenta">{err}</p>
            ) : (
              <p className="text-[14px] text-cream/60">{busy ? "…" : t("game.loading")}</p>
            )}
            <Link
              href="/library"
              className="g-btn g-btn-ghost mt-3 inline-flex items-center justify-center"
            >
              {t("solo.browseLibrary")}
            </Link>
          </div>
        )}

        {/* Found video — game info + mock play */}
        {video && (
          <div className={`g-panel ${fromLibrary ? "" : "mt-4"}`}>
            <div className="mb-4">
              <VideoStage src={video.sourceUrl} />
            </div>
            <h3 className="font-display text-[22px] font-black text-cream">
              {video.title || t("lib.untitled")}
            </h3>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  {t("solo.code")}
                </div>
                <div className="mt-1 font-display text-[15px] font-black tracking-[0.1em] text-mint">
                  {video.shareId ? formatShareId(video.shareId) : "—"}
                </div>
              </div>
              {(() => {
                // Green when the current party matches the recommended count,
                // yellow when it doesn't. Neutral if the user isn't in a party.
                const match = partyMatches;
                const tile =
                  partyCount === null
                    ? "bg-white/5"
                    : match
                      ? "bg-[rgba(39,225,161,0.16)] shadow-[inset_0_0_0_2px_rgba(39,225,161,0.6)]"
                      : "bg-[rgba(255,180,46,0.16)] shadow-[inset_0_0_0_2px_rgba(255,180,46,0.6)]";
                const num =
                  partyCount === null ? "text-cream" : match ? "text-mint" : "text-sun";
                return (
                  <div className={`rounded-[10px] p-3 text-center ${tile}`}>
                    <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                      {t("ppick.players")}
                    </div>
                    <div className={`mt-1 font-display text-[15px] font-black ${num}`}>
                      {video.players > 0 ? video.players : "—"}
                    </div>
                    {partyCount !== null && (
                      <div className="mt-0.5 font-display text-[10px] font-bold uppercase tracking-[0.06em] text-cream/45">
                        {t("ppick.yourParty", { n: partyCount })}
                      </div>
                    )}
                  </div>
                );
              })()}
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
              {/* Any party size can play — the studio shares sectors out to fit.
                  Only blocked if the video has no sectors, or you're not in a
                  party yet. Launching drops the whole party into the studio. */}
              <button
                onClick={() => void startForEveryone()}
                disabled={video.lines === 0 || !inParty || launching}
                className="g-btn g-btn-start w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {launching
                  ? t("ppick.starting")
                  : video.lines === 0
                    ? t("solo.noLinesYet")
                    : !inParty
                      ? t("ppick.needParty")
                      : isDuel
                        ? t("duel.startEveryone")
                        : t("ppick.startEveryone")}
              </button>

              {video.lines > 0 && !inParty && (
                <p className="text-center text-[13px] leading-[1.5] text-sun">
                  {t("ppick.notInParty", {
                    n: video.players,
                    players: video.players === 1 ? t("creator.player") : t("creator.players"),
                  })}
                </p>
              )}
              {/* Duel: both players dub the whole video — no cast-size heads-up. */}
              {video.lines > 0 && inParty && isDuel && (
                <p className="text-center text-[13px] leading-[1.5] text-sun">
                  {t("duel.pickNote")}
                </p>
              )}
              {/* Party: non-blocking heads-up when the size differs from the cast
                  count — fewer players double up characters, more players share. */}
              {video.lines > 0 && inParty && !isDuel && !partyMatches && partyCount !== null && (
                <p className="text-center text-[13px] leading-[1.5] text-sun">
                  {partyCount < video.players
                    ? t("ppick.fewerOk", { a: partyCount, b: video.players })
                    : t("ppick.moreOk", { a: partyCount, b: video.players })}
                </p>
              )}
            </div>
          </div>
        )}
          </>
        )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
