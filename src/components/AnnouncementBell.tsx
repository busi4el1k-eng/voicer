"use client";

import { useEffect, useRef, useState } from "react";
import { ANNOUNCEMENT, ANNOUNCEMENT_ACTIVE } from "@/lib/announcement";
import { useI18n } from "@/components/LanguageProvider";

const READ_KEY = "cinemadub.announcement.read"; // stores the last-read announcement id
const RING_EVERY_MS = 20000; // re-ring roughly every 20s while unread
const RING_MS = 900; // how long one ring animation lasts

// A bell button beside the language switcher. When there's an active
// announcement the player hasn't read yet, it shows a red dot and gives a short
// "ring" wiggle every ~20s until they open it. Opening marks it read (per
// browser, by announcement id) so it goes quiet. The message itself is authored
// in src/lib/announcement.ts.
export function AnnouncementBell() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [ringing, setRinging] = useState(false);
  const ringTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Decide unread state once mounted. This must run after hydration because
  // localStorage is client-only — the server (and first client render) always
  // start "read" (bell hidden), then this reveals it if there's a new message.
  useEffect(() => {
    if (!ANNOUNCEMENT_ACTIVE) return;
    let isUnread = true; // storage blocked → err on the side of showing it
    try {
      isUnread = localStorage.getItem(READ_KEY) !== ANNOUNCEMENT.id;
    } catch {
      /* keep true */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe post-mount read
    setUnread(isUnread);
  }, []);

  // Ring periodically while unread and the popover is closed.
  useEffect(() => {
    if (!unread || open) return;
    const ring = () => {
      setRinging(true);
      setTimeout(() => setRinging(false), RING_MS);
    };
    ring(); // ring once right away
    ringTimer.current = setInterval(ring, RING_EVERY_MS);
    return () => {
      if (ringTimer.current) clearInterval(ringTimer.current);
    };
  }, [unread, open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread) {
      // Opening it counts as reading it.
      try {
        localStorage.setItem(READ_KEY, ANNOUNCEMENT.id);
      } catch {
        /* ignore */
      }
      setUnread(false);
      setRinging(false);
    }
  };

  // The bell only exists while there's an unread announcement. Once the player
  // has read it (opened it and then closed the popover), it disappears — until a
  // NEW announcement is posted (a new id makes it unread again). We keep it
  // mounted while the popover is open so it doesn't vanish mid-read.
  if (!ANNOUNCEMENT_ACTIVE || (!unread && !open)) return null;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={t("announce.aria")}
        title={t("announce.aria")}
        className={`relative grid h-9 w-9 place-items-center rounded-[12px] shadow-[inset_0_0_0_2px_#8952dc,0_3px_0_0_rgba(17,0,69,0.4)] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#8952dc,0_1px_0_0_rgba(17,0,69,0.4)] ${
          ringing ? "bell-ring" : ""
        }`}
        style={{ background: "rgba(37,28,92,0.7)" }}
      >
        {/* Bell icon */}
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FFF6EC"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transformOrigin: "top center" }}
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#251c5c] bg-magenta"
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] rounded-[12px] p-4 text-left shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
            style={{ backgroundColor: "#251c5c", boxShadow: "inset 0 0 0 2px #8952dc" }}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[15px]">📢</span>
              <h3 className="font-display text-[15px] font-black text-cream">
                {ANNOUNCEMENT.title || t("announce.title")}
              </h3>
            </div>
            <p className="text-[13px] leading-relaxed text-cream/80">{ANNOUNCEMENT.message}</p>
          </div>
        </>
      )}
    </div>
  );
}
