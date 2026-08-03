"use client";

import { useEffect, useState } from "react";
import { StarRating } from "@/components/StarRating";
import type { PlayerView } from "@/lib/useRoom";

// Post-game rating: score every OTHER player in the room 0–5 stars. Restores any
// scores this player already gave (so a reload doesn't lose them) and saves the
// whole set in one request. Guests can rate too; scores land on the rated
// player's account when they have one (see the dashboard "Rating" stat).
export function RatePlayers({
  code,
  playerId,
  players,
}: {
  code: string;
  playerId: string;
  players: PlayerView[];
}) {
  const others = players.filter((p) => p.id !== playerId);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Restore previously-given scores for this room + player.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/room/rate?code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(playerId)}`,
        );
        if (!r.ok) return;
        const d = (await r.json()) as { ratings?: Record<string, number> };
        if (cancelled || !d.ratings) return;
        setRatings(d.ratings);
        if (Object.keys(d.ratings).length > 0) setSaved(true);
      } catch {
        /* best-effort restore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, playerId]);

  if (others.length === 0) return null;

  const anyRated = others.some((p) => ratings[p.id] != null);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/room/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, playerId, ratings }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Couldn't save ratings.");
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save ratings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t border-cream/10 pt-5 text-left">
      <h3 className="mb-1 text-center font-display text-[16px] font-black text-cream">
        Rate the cast
      </h3>
      <p className="mb-4 text-center text-[12px] text-cream/55">
        {saved ? "Thanks! You can still tweak your scores." : "Give each performance 0–5 stars."}
      </p>

      <div className="flex flex-col gap-2">
        {others.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-3 rounded-[10px] bg-white/5 px-4 py-3"
          >
            <span
              className="grid h-8 w-8 flex-none place-items-center rounded-[8px] font-display text-[14px] font-black text-white"
              style={{ backgroundColor: p.avatarColor }}
            >
              {p.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate font-display text-[14px] font-bold text-cream">
              P{p.seat} · {p.displayName}
            </span>
            <StarRating
              value={ratings[p.id] ?? 0}
              onChange={(v) => {
                setRatings((prev) => ({ ...prev, [p.id]: v }));
                setSaved(false);
              }}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => void submit()}
        disabled={busy || !anyRated}
        className="g-btn g-btn-primary mt-4 w-full"
      >
        {busy ? "Saving…" : saved ? "Update ratings" : "Submit ratings"}
      </button>
      {err && <p className="mt-2 text-center text-[13px] text-magenta">{err}</p>}
    </div>
  );
}
