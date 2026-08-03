"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountBar } from "@/components/AccountBar";
import { VideoStage } from "@/components/VideoStage";
import { formatShareId, formatShareInput } from "@/lib/share-id";
import { useRoom } from "@/lib/useRoom";

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
  const [code, setCode] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);

  // The invite-lobby room the user is in (created from the dashboard, persisted
  // in localStorage + polled). Read here only, to show the live party size.
  const { room, playerId, inRoom, isHost, leave } = useRoom({ displayName: "", avatarColor: "" });
  // Only the host chooses the video; every other member waits. `inRoom`/`isHost`
  // are optimistic (from the stored membership) so the waiting view shows
  // instantly, before the room fetch resolves.
  const isMember = inRoom && !isHost;
  const partyCount = room ? room.players.length : null;
  // Party play is fully restricted unless the party size exactly matches the
  // video's recommended player count.
  const partyMatches = !!video && partyCount !== null && partyCount === video.players;

  // Once the host launches (room flips to "dubbing"), the host and every waiting
  // member follow into the studio together. Also covers "finished" so a late
  // poll still routes correctly.
  useEffect(() => {
    if (room?.status === "dubbing" || room?.status === "finished") router.push("/party/studio");
  }, [room?.status, router]);

  // Host locks in the found video and starts the game for the whole party.
  const startForEveryone = async () => {
    if (!video || !room || !playerId) return;
    setLaunching(true);
    setErr("");
    try {
      const r = await fetch("/api/room/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: room.code, playerId, uploadId: video.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't start the game.");
      router.push("/party/studio");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the game.");
      setLaunching(false);
    }
  };

  const search = async (override?: string) => {
    const trimmed = (override ?? code).trim();
    if (!trimmed) return setErr("Enter a share code.");
    setBusy(true);
    setErr("");
    setVideo(null);
    try {
      const r = await fetch(`/api/solo/lookup?code=${encodeURIComponent(trimmed)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Lookup failed.");
      setVideo(d.video as Video);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  };

  // A code handed off from the Video library ("Party mode") pre-fills the search
  // and looks the video up automatically, so the host lands right on it.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (!c) return;
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
          Party<em>Dub</em>
        </h1>
      </div>

      <div className="w-full max-w-xl">
        {isMember ? (
          // Non-host members wait — the host picks the video for everyone.
          // Renders instantly from the membership hint; the roster fills in
          // once the room loads.
          <>
            <h2 className="g-title">Waiting room</h2>
            <div className="g-panel">
              <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
                ⏳
              </div>
              <p className="text-center text-[14px] leading-[1.5] text-cream">
                <b>{room?.players.find((p) => p.isHost)?.displayName ?? "The host"}</b> is choosing a
                video. The game starts when they pick — sit tight.
              </p>
              <p className="mt-2 text-center font-display text-[11px] font-bold uppercase tracking-[0.05em] text-cream/50">
                {room ? `${room.players.length} in your party` : "Connecting…"}
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
                      {p.id === playerId && <span className="text-cream/50"> (you)</span>}
                    </span>
                    {p.isHost && (
                      <span className="rounded-[6px] bg-sun px-2 py-0.5 font-display text-[10px] font-black uppercase text-ink">
                        Host
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
                Leave room
              </button>
            </div>
          </>
        ) : (
          <>
        <h2 className="g-title">Find a video to party-dub</h2>

        {/* Code search */}
        <div className="g-panel">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(formatShareInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
              placeholder="e.g. ABCD-EFGH"
              maxLength={9}
              autoFocus
              className="flex-1 rounded-[10px] bg-violet-deep/60 px-4 py-3 font-display text-[16px] font-bold uppercase tracking-[0.12em] text-cream placeholder:font-normal placeholder:tracking-normal placeholder:text-cream/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            />
            <button onClick={() => void search()} disabled={busy} className="g-btn g-btn-primary px-5">
              {busy ? "…" : "Search"}
            </button>
          </div>
          {err && <p className="mt-3 text-[13px] text-magenta">{err}</p>}
          <p className="mt-3 text-[12px] leading-[1.5] text-cream/50">
            Ask the creator for the video&apos;s share code, then enter it here to set up a party dub
            with friends.
          </p>
        </div>

        {/* Found video — game info + mock play */}
        {video && (
          <div className="g-panel mt-4">
            <div className="mb-4">
              <VideoStage src={video.sourceUrl} />
            </div>
            <h3 className="font-display text-[22px] font-black text-cream">
              {video.title || "Untitled"}
            </h3>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  Code
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
                      : "bg-[rgba(255,210,63,0.16)] shadow-[inset_0_0_0_2px_rgba(255,210,63,0.6)]";
                const num =
                  partyCount === null ? "text-cream" : match ? "text-mint" : "text-sun";
                return (
                  <div className={`rounded-[10px] p-3 text-center ${tile}`}>
                    <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                      Players
                    </div>
                    <div className={`mt-1 font-display text-[15px] font-black ${num}`}>
                      {video.players > 0 ? video.players : "—"}
                    </div>
                    {partyCount !== null && (
                      <div className="mt-0.5 font-display text-[10px] font-bold uppercase tracking-[0.06em] text-cream/45">
                        your party: {partyCount}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  Lines
                </div>
                <div className="mt-1 font-display text-[15px] font-black text-cream">
                  {video.lines}
                </div>
              </div>
              <div className="rounded-[10px] bg-white/5 p-3 text-center">
                <div className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
                  Length
                </div>
                <div className="mt-1 font-display text-[15px] font-black text-cream">
                  {video.durationMs ? fmtDuration(video.durationMs) : "—"}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {/* Fully restricted unless the party size exactly matches the
                  recommendation. Launching drops the whole party into the studio. */}
              <button
                onClick={() => void startForEveryone()}
                disabled={video.lines === 0 || !partyMatches || launching}
                className="g-btn g-btn-start w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {launching
                  ? "Starting…"
                  : video.lines === 0
                    ? "No lines to dub yet"
                    : partyMatches
                      ? "Start for everyone →"
                      : "Party size must match"}
              </button>

              {video.lines > 0 && !partyMatches && (
                <p className="text-center text-[13px] leading-[1.5] text-sun">
                  {partyCount === null
                    ? `You're not in a party. This video needs exactly ${video.players} ${
                        video.players === 1 ? "player" : "players"
                      } — create or join a room from the dashboard.`
                    : partyCount < video.players
                      ? `Your party has ${partyCount}. This video needs exactly ${video.players} — invite ${
                          video.players - partyCount
                        } more.`
                      : `Your party has ${partyCount}. This video needs exactly ${video.players} — remove ${
                          partyCount - video.players
                        }.`}
                </p>
              )}
            </div>
          </div>
        )}
          </>
        )}

        <div className="mt-6 text-center">
          {/* A member must leave the room first, else the dashboard's follow
              effect pulls them straight back to /party. */}
          <button
            onClick={async () => {
              if (isMember) await leave();
              router.push("/dashboard");
            }}
            className="text-[13px] text-cream/50 underline"
          >
            Back to lobby
          </button>
        </div>
      </div>
    </main>
  );
}
