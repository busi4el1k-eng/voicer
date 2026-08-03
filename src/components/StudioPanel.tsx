"use client";

import { useState } from "react";
import { useRoom } from "@/lib/useRoom";
import { MAX_PLAYERS, normalizeRoomCode } from "@/lib/room-code";

export type Stat = { label: string; value: number | string };

const OTHER_SEATS = MAX_PLAYERS - 1; // seats besides "you" (the top user box)

export function StudioPanel({
  name,
  isGuest,
  avatarColor,
  initial,
  stats,
}: {
  name: string;
  isGuest: boolean;
  avatarColor: string;
  initial: string;
  stats: Stat[];
}) {
  const [showStats, setShowStats] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { room, playerId, busy, error, setError, create, join, leave } = useRoom({
    displayName: name,
    avatarColor,
  });

  // Everyone in the room except me — they fill the seats below my user box.
  const others = room?.players.filter((p) => p.id !== playerId) ?? [];
  const openSeats = Math.max(0, OTHER_SEATS - others.length);
  const full = room ? room.players.length >= MAX_PLAYERS : false;

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is still visible to read out */
    }
  };

  // Pressing a ghost seat pops the invite window. With no room yet it opens one
  // first (and I become host); the window then shows the code to share.
  const onGhostClick = () => {
    if (busy) return;
    setError(null);
    setInviteOpen(true);
    if (!room) create();
  };

  const submitJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await join(codeInput);
    if (ok) {
      setJoining(false);
      setCodeInput("");
    }
  };

  return (
    <div className="g-panel flex flex-1 flex-col gap-3">
      <div className="g-user">
        <div className="g-avt" style={{ backgroundColor: avatarColor }}>
          {initial}
        </div>
        <div>
          <div className="g-uname">{name}</div>
          <div className="g-utag">
            {room ? (room.players.find((p) => p.id === playerId)?.isHost ? "HOST" : "IN ROOM") : isGuest ? "GUEST" : "MEMBER"}
          </div>
        </div>

        {/* 3-dots toggle — reveals the stats panel */}
        <button
          type="button"
          className="g-dots"
          aria-expanded={showStats}
          aria-label={showStats ? "Hide statistics" : "Show statistics"}
          onClick={() => setShowStats((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {/* Collapsible stats — animates open/closed directly under the player */}
      <div className={`g-stats-collapse${showStats ? " open" : ""}`}>
        <div className="g-stats-inner flex flex-col gap-2">
          {stats.map((s) => (
            <div key={s.label} className="g-stat">
              <span className="g-stat-label">{s.label}</span>
              <span className="g-stat-value">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Invite banner — shown while a room is open and has empty seats. Tapping
          it re-opens the invite window. */}
      {room && !full && (
        <button type="button" className="g-invite" onClick={() => setInviteOpen(true)}>
          <span className="g-invite-cap">Invite code — tap to show</span>
          <span className="g-invite-code">{room.code}</span>
        </button>
      )}

      {/* Player seats: joined players fill in, empty ones stay ghosts */}
      <div className="g-party">
        {others.map((p) => (
          <div key={p.id} className="g-ghost-slot filled">
            <span className="g-ghost-avt" style={{ backgroundColor: p.avatarColor, color: "#fff", borderStyle: "solid" }}>
              {p.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="g-player-name">{p.displayName}</span>
            {p.isHost && <span className="g-player-tag">HOST</span>}
          </div>
        ))}

        {Array.from({ length: openSeats }).map((_, i) => (
          <button
            key={`ghost-${i}`}
            type="button"
            className="g-ghost-slot"
            onClick={onGhostClick}
            disabled={busy}
          >
            <span className="g-ghost-avt" aria-hidden="true">
              <GhostIcon />
            </span>
            <span className="g-ghost-label">
              {busy && !room ? "Opening room…" : room ? "Invite a player…" : "Add a player…"}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="text-[12px] text-magenta">{error}</p>}

      {/* Enter / leave a room */}
      {room ? (
        <button type="button" className="g-btn g-btn-ghost h-[42px] w-full text-[14px]" onClick={leave}>
          Leave room
        </button>
      ) : joining ? (
        <form onSubmit={submitJoin} className="flex flex-col gap-2">
          <input
            autoFocus
            value={codeInput}
            onChange={(e) => {
              setCodeInput(normalizeRoomCode(e.target.value));
              setError(null);
            }}
            placeholder="ROOM CODE"
            maxLength={4}
            className="g-code-input"
          />
          <div className="flex flex-col gap-2">
            <button type="submit" className="g-btn g-btn-primary h-[42px] w-full text-[14px]" disabled={busy}>
              {busy ? "Joining…" : "Join"}
            </button>
            <button
              type="button"
              className="g-btn g-btn-ghost h-[42px] w-full text-[14px]"
              onClick={() => {
                setJoining(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="g-btn g-btn-ghost h-[42px] w-full text-[14px]"
          onClick={() => setJoining(true)}
        >
          Enter a room
        </button>
      )}

      {isGuest && !room && (
        <p className="mt-auto text-[12px] leading-[1.5] text-cream/55">
          You&apos;re playing as a guest. Sign in to track your runs and scores.
        </p>
      )}

      {/* Invite popup window — shows the room code to share */}
      {inviteOpen && (
        <div className="g-modal-overlay" onClick={() => setInviteOpen(false)}>
          <div className="g-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="g-modal-x"
              aria-label="Close"
              onClick={() => setInviteOpen(false)}
            >
              ×
            </button>
            <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
              🎟️
            </div>
            <h3 className="g-modal-title">Invite a player</h3>

            {room ? (
              <>
                <p className="g-modal-sub">
                  Share this code — up to {MAX_PLAYERS} players can join your room.
                </p>
                <div className="g-modal-code">{room.code}</div>
                <button type="button" className="g-btn g-btn-primary w-full" onClick={copyCode}>
                  {copied ? "Copied!" : "Copy code"}
                </button>
                <p className="g-modal-count">
                  {room.players.length}/{MAX_PLAYERS} in room · waiting for players…
                </p>
              </>
            ) : error ? (
              <>
                <p className="g-modal-sub text-magenta">{error}</p>
                <button type="button" className="g-btn g-btn-primary w-full" onClick={() => create()}>
                  Try again
                </button>
              </>
            ) : (
              <p className="g-modal-sub">Opening room…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GhostIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M12 2a8 8 0 0 0-8 8v10.2c0 .8.94 1.23 1.55.7l1.4-1.22a1 1 0 0 1 1.32.01l1.06.93a1 1 0 0 0 1.32 0l1.06-.93a1 1 0 0 1 1.32 0l1.06.93a1 1 0 0 0 1.32 0l1.06-.93a1 1 0 0 1 1.32-.01l1.4 1.22c.61.53 1.55.1 1.55-.7V10a8 8 0 0 0-8-8Zm-3 9a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm6 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z" />
    </svg>
  );
}
