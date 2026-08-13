"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRoom, type RoomView } from "@/lib/useRoom";
import { useI18n } from "@/components/LanguageProvider";
import { MAX_PLAYERS, MIN_PLAYERS, normalizeRoomCode } from "@/lib/room-code";

type Mode = {
  id: string;
  icon: string;
  titleKey: string; // i18n key, translated at render
  textKey: string;
  href?: string; // present = working; absent = placeholder (coming soon)
  ghost?: boolean; // hidden/unrevealed slot ("???")
};

const MODES: Mode[] = [
  {
    id: "creator",
    icon: "✂️",
    titleKey: "mode.creator.title",
    textKey: "mode.creator.text",
    href: "/creator",
  },
  {
    id: "library",
    icon: "🎞️",
    titleKey: "mode.library.title",
    textKey: "mode.library.text",
    href: "/library",
  },
  {
    id: "party",
    icon: "🎉",
    titleKey: "mode.party.title",
    textKey: "mode.party.text",
    href: "/party",
  },
  {
    id: "solo",
    icon: "🎬",
    titleKey: "mode.solo.title",
    textKey: "mode.solo.text",
    href: "/play",
  },
  {
    id: "ghost",
    icon: "❓",
    titleKey: "mode.soon.title",
    textKey: "mode.soon.text",
    ghost: true,
  },
];

// Appears when a guest tries to open the members-only creator, instead of a
// static notice sitting under the cards.
function GuestGate({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/70" onClick={onClose} />
      <div
        className="g-panel relative z-10 w-full max-w-sm text-center"
        style={{ backgroundColor: "#251c5c" }}
      >
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-sun/20 text-[28px] shadow-[inset_0_0_0_2px_rgba(255,210,63,0.4)]">
          🔒
        </div>
        <h3 className="font-display text-[20px] font-black uppercase tracking-[0.04em] text-cream">
          {t("gate.title")}
        </h3>
        <p className="mt-2 text-[13px] leading-[1.5] text-cream/70">{t("gate.text")}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/login" className="g-btn g-btn-primary w-full">
            {t("gate.signIn")}
          </Link>
          <button onClick={onClose} className="g-btn g-btn-ghost w-full">
            {t("gate.later")}
          </button>
        </div>
      </div>
    </div>
  );
}

// The waiting window shown to every non-host member of a party. They can see
// who's in the room and who's host, but the host leads — so the only action is
// "Leave room". When the host starts, the parent auto-navigates everyone in.
function WaitingRoom({
  room,
  playerId,
  busy,
  onLeave,
}: {
  room: RoomView | null;
  playerId: string | null;
  busy: boolean;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const host = room?.players.find((p) => p.isHost);
  return (
    <div className="g-modal-overlay">
      <div className="g-modal">
        <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
          ⏳
        </div>
        <h3 className="g-modal-title">{t("wait.title")}</h3>
        <p className="g-modal-sub">
          {host
            ? t("wait.hostLead", { host: host.displayName })
            : t("wait.hostLeadNoName")}
        </p>
        <p className="g-modal-count">
          {room
            ? t("wait.inRoom", { a: room.players.length, b: MAX_PLAYERS })
            : t("wait.connecting")}
        </p>

        <ul className="flex w-full flex-col gap-2">
          {(room?.players ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-[10px] bg-white/5 px-3 py-2 text-left"
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
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="g-btn g-btn-ghost w-full"
          onClick={onLeave}
          disabled={busy}
        >
          {t("common.leaveRoom")}
        </button>
      </div>
    </div>
  );
}

// The Gartic-style lobby: left profile/stats (rendered by the page), right a
// grid of selectable mode cards + a START action. Guests can play but can't
// create videos, so opening the creator pops the members-only gate (mirrors the
// 403 the upload route returns).
export function Lobby({
  isGuest = false,
  playerName = "",
  avatarColor = "",
}: {
  isGuest?: boolean;
  playerName?: string;
  avatarColor?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState("creator");
  const [note, setNote] = useState(false);
  const [gate, setGate] = useState(false);

  // Party mode entry: a party (room) is required to play. With no party we hide
  // "Start" and open a modal (same panel style as the studio's "Add a player")
  // to create/join one; once you have a party you can enter the game directly.
  const [partyOpen, setPartyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const {
    room,
    playerId,
    inRoom,
    isHost,
    busy: roomBusy,
    error: roomError,
    setError: setRoomError,
    create,
    join,
    start,
    leave,
  } = useRoom({ displayName: playerName, avatarColor });

  // Party mode needs a party of at least MIN_PLAYERS before anyone can enter.
  const partyReady = !!room && room.players.length >= MIN_PLAYERS;

  // Only the host leads: they pick the mode and start for everyone. Everyone
  // else is a "member" — they sit in a waiting window and can only leave until
  // the host starts. `inRoom`/`isHost` come from the hook's optimistic
  // membership so this shows instantly, before the room fetch resolves.
  const isMember = inRoom && !isHost;

  // Members follow the host automatically as the game advances. Handle every
  // post-lobby status (not just "playing") so a member who polls in late — after
  // the host already picked a video — still gets pulled to the right place.
  useEffect(() => {
    if (!room || isHost) return;
    if (room.status === "dubbing") router.push("/party/studio");
    else if (room.status === "playing") router.push("/party");
    // "lobby" → wait here on the dashboard. "finished" → don't yank a member
    // resting on the dashboard into a finished game; they stay in the room and
    // get pulled in when the host starts the next one.
  }, [room, isHost, router]);

  // Host action: start the party for everyone, then head in.
  const startParty = async () => {
    if (await start()) router.push("/party");
  };

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

  const launch = (mode: Mode) => {
    if (mode.ghost) return; // greyed-out placeholder — does nothing
    if (isGuest && mode.id === "creator") {
      setGate(true);
      return;
    }
    // Party mode: a full-enough party (≥ MIN_PLAYERS) enters the game directly;
    // otherwise open the modal to create/join or gather more players.
    if (mode.id === "party") {
      setRoomError(null);
      if (partyReady) router.push("/party");
      else setPartyOpen(true);
      return;
    }
    if (mode.href) router.push(mode.href);
    else setNote(true); // a mock mode (looks normal, not wired up yet)
  };

  return (
    <div className="g-right self-stretch">
      <h2 className="g-title">{t("lobby.modes")}</h2>

      <div className="g-panel min-h-[340px] flex-1">
        <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 [&_.g-card-inner]:min-h-[104px]">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelected(m.id);
                launch(m);
              }}
              disabled={m.ghost}
              className={`g-card${m.ghost ? " soon" : ""}`}
            >
              <div className="g-card-inner">
                {m.ghost ? (
                  // Greyed-out, locked placeholder — unrevealed mode.
                  <>
                    <span className="g-soontag">{t("lobby.soonTag")}</span>
                    <div className="g-ficon">❓</div>
                    <section>
                      <h4>{t("mode.soon.title")}</h4>
                      <p>{t("mode.soon.text")}</p>
                    </section>
                  </>
                ) : (
                  <>
                    <div className="g-ficon">{m.icon}</div>
                    <section>
                      <h4>{t(m.titleKey)}</h4>
                      <p>{t(m.textKey)}</p>
                    </section>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="g-actions flex-col gap-2">
        {selected === "party" &&
          // Party mode requires a party of at least MIN_PLAYERS. Ready → enter
          // directly; otherwise a button opens the create/gather modal.
          (partyReady ? (
            <button className="g-btn g-btn-start" onClick={startParty} disabled={roomBusy}>
              {t("party.startParty")}
            </button>
          ) : (
            <button
              className="g-btn g-btn-primary"
              onClick={() => {
                setRoomError(null);
                setPartyOpen(true);
              }}
            >
              {room ? t("party.setup") : t("party.create")}
            </button>
          ))}
        {note && <p className="text-[12px] text-cream/60">{t("lobby.comingSoon")}</p>}
      </div>

      {gate && <GuestGate onClose={() => setGate(false)} />}

      {/* Members (everyone but the host) wait here — they can see the party and
          leave, but the host leads and chooses what to play. Shows instantly
          from the membership hint; the roster fills in once the room loads. */}
      {isMember && (
        <WaitingRoom room={room} playerId={playerId} busy={roomBusy} onLeave={leave} />
      )}

      {/* Party-mode modal — same panel style as the studio's "Add a player".
          Create/join a party, or (once you have one) enter the game. */}
      {partyOpen && !isMember && (
        <div className="g-modal-overlay" onClick={() => setPartyOpen(false)}>
          <div className="g-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="g-modal-x"
              aria-label={t("common.close")}
              onClick={() => setPartyOpen(false)}
            >
              ×
            </button>
            <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
              🎉
            </div>
            <h3 className="g-modal-title">{t("party.title")}</h3>

            {room ? (
              <>
                <p className="g-modal-sub">{t("studio.shareCode", { n: MAX_PLAYERS })}</p>
                <div className="g-modal-code">{room.code}</div>
                <button type="button" className="g-btn g-btn-primary w-full" onClick={copyCode}>
                  {copied ? t("common.copied") : t("common.copyCode")}
                </button>
                <p className="g-modal-count">
                  {t("wait.inRoom", { a: room.players.length, b: MAX_PLAYERS })}
                </p>
                {partyReady ? (
                  <button
                    type="button"
                    className="g-btn g-btn-start w-full"
                    onClick={startParty}
                    disabled={roomBusy}
                  >
                    {t("party.startParty")}
                  </button>
                ) : (
                  <p className="g-modal-sub text-sun">{t("party.needMore", { n: MIN_PLAYERS })}</p>
                )}
              </>
            ) : roomBusy ? (
              <p className="g-modal-sub">{t("common.working")}</p>
            ) : (
              <>
                {roomError && <p className="g-modal-sub text-magenta">{roomError}</p>}
                <p className="g-modal-sub">{t("party.host")}</p>
                <button type="button" className="g-btn g-btn-primary w-full" onClick={() => create()}>
                  {t("party.generate")}
                </button>

                <div className="my-1 flex w-full items-center gap-2">
                  <span className="h-px flex-1 bg-white/15" />
                  <span className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/40">
                    {t("party.orJoin")}
                  </span>
                  <span className="h-px flex-1 bg-white/15" />
                </div>

                <input
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(normalizeRoomCode(e.target.value));
                    setRoomError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && joinCode) void join(joinCode);
                  }}
                  placeholder={t("common.roomCode")}
                  maxLength={4}
                  className="g-code-input"
                />
                <button
                  type="button"
                  className="g-btn g-btn-ghost w-full"
                  onClick={() => void join(joinCode)}
                  disabled={!joinCode}
                >
                  {t("party.joinRoom")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
