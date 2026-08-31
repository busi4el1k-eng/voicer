"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRoom, type RoomView } from "@/lib/useRoom";
import { useI18n } from "@/components/LanguageProvider";
import { GameIcon, type GameIconName } from "@/components/GameIcon";
import { MAX_PLAYERS, MIN_PLAYERS, normalizeRoomCode } from "@/lib/room-code";

type Mode = {
  id: string;
  icon: string;
  titleKey: string; // i18n key, translated at render
  textKey: string;
  href?: string; // present = working; absent = placeholder (coming soon)
  ghost?: boolean; // hidden/unrevealed slot ("???")
  image?: string; // illustration shown in place of the GameIcon
};

const MODES: Mode[] = [
  {
    id: "creator",
    icon: "creator",
    titleKey: "mode.creator.title",
    textKey: "mode.creator.text",
    href: "/creator",
    image: "/modes/creator.png",
  },
  {
    id: "library",
    icon: "library",
    titleKey: "mode.library.title",
    textKey: "mode.library.text",
    href: "/library",
    image: "/modes/library.png",
  },
  {
    id: "party",
    icon: "party",
    titleKey: "mode.party.title",
    textKey: "mode.party.text",
    href: "/party",
    image: "/modes/party.png",
  },
  {
    id: "duel",
    icon: "duel",
    titleKey: "mode.duel.title",
    textKey: "mode.duel.text",
    href: "/party", // shared pick screen; room.mode drives the duel flow
    image: "/modes/duel.png",
  },
  {
    id: "solo",
    icon: "solo",
    titleKey: "mode.solo.title",
    textKey: "mode.solo.text",
    href: "/play",
    image: "/modes/solo.png",
  },
  {
    id: "ghost",
    icon: "soon",
    titleKey: "mode.soon.title",
    textKey: "mode.soon.text",
    ghost: true,
    image: "/modes/soon.png",
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
        style={{ backgroundColor: "#10394f" }}
      >
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-sun/20 text-[28px] shadow-[inset_0_0_0_2px_rgba(255,180,46,0.4)]">
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
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState(false);
  const [gate, setGate] = useState(false);

  // Mode strip scrolling. On desktop it's click-and-drag: pressing and releasing
  // in place is a real button click, but pressing and moving scrolls the strip
  // and the trailing click is swallowed (capture-phase guard). On touch we run a
  // TikTok/Reels-style pager: a swipe advances exactly one card and eases into
  // place, instead of free-flinging past several. Vertical swipes still scroll the
  // page (touch-action: pan-y hands horizontal gestures to us).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;

    const cards = () => Array.from(el.children) as HTMLElement[];
    // Index of the card whose left edge currently sits closest to the viewport.
    const nearestIndex = () => {
      const c = cards();
      let best = 0;
      let bestD = Infinity;
      c.forEach((child, i) => {
        const d = Math.abs(child.offsetLeft - el.scrollLeft);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    // Ease to card `i` (clamped), landing exactly on its edge.
    const pageTo = (i: number) => {
      const c = cards();
      const clamped = Math.max(0, Math.min(c.length - 1, i));
      el.scrollTo({ left: c[clamped].offsetLeft, behavior: "smooth" });
    };

    // --- desktop: click-and-drag ---
    let down = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.pageX;
      startScroll = el.scrollLeft;
      el.classList.add("dragging");
    };
    const onMove = (e: MouseEvent) => {
      if (!down) return;
      const walk = e.pageX - startX;
      if (Math.abs(walk) > 5) moved = true;
      el.scrollLeft = startScroll - walk;
      e.preventDefault();
    };
    const onUp = () => {
      down = false;
      el.classList.remove("dragging");
    };
    // If the press turned into a drag, swallow the click so the mode doesn't open.
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };

    // --- touch: one-card-per-swipe pager ---
    let tDown = false;
    let tStartX = 0;
    let tStartY = 0;
    let tScroll = 0;
    let tIndex = 0;
    let horizontal: boolean | null = null; // lock axis after the first few px
    const onTouchStart = (e: TouchEvent) => {
      tDown = true;
      tStartX = e.touches[0].pageX;
      tStartY = e.touches[0].pageY;
      tScroll = el.scrollLeft;
      tIndex = nearestIndex();
      horizontal = null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!tDown) return;
      const dx = e.touches[0].pageX - tStartX;
      const dy = e.touches[0].pageY - tStartY;
      if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (horizontal) {
        e.preventDefault(); // we own this gesture; keep the finger glued to the strip
        el.scrollLeft = tScroll - dx;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!tDown) return;
      tDown = false;
      if (!horizontal) return;
      const dx = e.changedTouches[0].pageX - tStartX;
      // A decisive swipe pages one card; a small nudge snaps back to where it was.
      if (dx < -40) pageTo(tIndex + 1);
      else if (dx > 40) pageTo(tIndex - 1);
      else pageTo(tIndex);
    };

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Party/duel entry: a room (party) is required to play. With no room we hide
  // "Start" and open a modal (same panel style as the studio's "Add a player")
  // to create/join one; once you have a party of players the host chooses the
  // game — co-op "party" or competitive "duel" — right there.
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
    restart,
  } = useRoom({ displayName: playerName, avatarColor });

  // A room needs at least MIN_PLAYERS before any game (party or duel) can start.
  // The game TYPE is not fixed to the room — it's chosen at launch (see start()),
  // so the same party can play either mode.
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

  // Host action: launch the chosen game type for everyone, then head in. The
  // members follow automatically once the room flips to "playing".
  const startGame = async (mode: "party" | "duel") => {
    if (await start(mode)) router.push("/party");
  };

  // Safety net: reopen a stale room for joining. Starting the game flips the
  // room to "playing" (so members follow the host to the pick screen); if the
  // host later returns to the dashboard by ANY route other than the reset
  // button — browser back, the logo, a fresh visit — the room can be left stuck
  // in "playing" with joins blocked. Whenever the host is sitting here (i.e. not
  // in play mode) on a "playing" room, drop it back to "lobby". The short delay
  // avoids racing a legitimate launch: startGame navigates to /party, which
  // unmounts this component and clears the timer before it can fire. We only
  // touch "playing" — "dubbing" is an active game, and "finished" is left alone
  // so members still reading the result/ratings screen aren't yanked away.
  useEffect(() => {
    if (!isHost || room?.status !== "playing") return;
    const id = setTimeout(() => void restart("lobby"), 1200);
    return () => clearTimeout(id);
  }, [isHost, room?.status, restart]);

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
    // Party & duel share one room; the modal gathers players and, once there are
    // enough, lets the host pick the game. Both cards enter the same way — click
    // opens the create/join modal, whether or not a room exists yet.
    if (mode.id === "party" || mode.id === "duel") {
      setRoomError(null);
      setPartyOpen(true);
      return;
    }
    if (mode.href) router.push(mode.href);
    else setNote(true); // a mock mode (looks normal, not wired up yet)
  };

  return (
    <div className="g-right self-stretch">
      <h2 className="g-title">{t("lobby.modes")}</h2>

      <div className="g-panel">
        {/* Big image tiles in a horizontal, left-right scrolling strip. The image
            IS the button (no frame / crop / shadow); the name sits below it. */}
        <div ref={stripRef} className="g-modestrip">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelected(m.id);
                launch(m);
              }}
              disabled={m.ghost}
              className={`g-modecard${m.ghost ? " soon" : ""}${selected === m.id ? " checked" : ""}`}
            >
              <div className="g-modecard-imgwrap">
                {m.image ? (
                  <img src={m.image} alt="" aria-hidden className="g-modecard-img" />
                ) : (
                  <div
                    className="g-modecard-img grid aspect-square place-items-center"
                    style={{ background: "radial-gradient(120% 120% at 30% 20%, #226c99, #0f3a54)" }}
                  >
                    <GameIcon name={(m.ghost ? "soon" : m.icon) as GameIconName} size={72} />
                  </div>
                )}
                {m.ghost && <span className="g-soontag">{t("lobby.soonTag")}</span>}
              </div>
              <span className="g-modecard-title">{t(m.ghost ? "mode.soon.title" : m.titleKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Actions row: mode entry is driven entirely by clicking the cards (which
          open the create/join/start modal), so the only thing left here is the
          coming-soon note for mock modes. Render it only when present — an empty
          row still carries its margin-top and misaligns the modes panel. */}
      {note && (
        <div className="g-actions flex-col gap-2">
          <p className="text-[12px] text-cream/60">{t("lobby.comingSoon")}</p>
        </div>
      )}

      {gate && <GuestGate onClose={() => setGate(false)} />}

      {/* Members (everyone but the host) wait here — they can see the party and
          leave, but the host leads and chooses what to play. Shows instantly
          from the membership hint; the roster fills in once the room loads. */}
      {isMember && (
        <WaitingRoom room={room} playerId={playerId} busy={roomBusy} onLeave={leave} />
      )}

      {/* Setup modal — same panel style as the studio's "Add a player". One room
          for both game types: create / join / invite players, then (once there
          are enough) the host picks the game — co-op Party or competitive Duel. */}
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
            <h3 className="g-modal-title">
              {selected === "duel" ? t("duel.title") : t("party.title")}
            </h3>

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
                  // Enough players — launch the game the host picked with the card
                  // (party or duel). Only that mode's button shows here.
                  <div className="flex w-full flex-col gap-2">
                    <button
                      type="button"
                      className="g-btn g-btn-start w-full"
                      onClick={() => void startGame(selected as "party" | "duel")}
                      disabled={roomBusy}
                    >
                      {selected === "duel" ? t("duel.startDuel") : t("party.startParty")}
                    </button>
                  </div>
                ) : (
                  <p className="g-modal-sub text-sun">{t("party.needMore", { n: MIN_PLAYERS })}</p>
                )}
              </>
            ) : roomBusy ? (
              <p className="g-modal-sub">{t("common.working")}</p>
            ) : (
              <>
                {roomError && <p className="g-modal-sub text-magenta">{roomError}</p>}
                <p className="g-modal-sub">
                  {selected === "duel" ? t("duel.host") : t("party.host")}
                </p>
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
