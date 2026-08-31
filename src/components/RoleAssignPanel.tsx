"use client";

// Cast-the-roles window. A left-hand panel shown on the party pick screen once
// a host has found a video and gathered a party. It lists the players by name
// and, per player, one P-button per character. By DEFAULT it shows exactly what
// the game will do — the automatic sector share-out (lib/party-assign) rendered
// as picks — so nobody is surprised. When the HOST changes a pick it's saved to
// the room (/api/room/roles) and the studio + submit route honor it, so the
// casting shown here is the casting that actually happens. Guests see it live,
// read-only.

import { useEffect, useMemo, useState } from "react";
import type { PlayerView } from "@/lib/useRoom";
import {
  type AssignSeg,
  roleList,
  defaultRoleAssign,
} from "@/lib/party-assign";

type Seg = AssignSeg;

export function RoleAssignPanel({
  videoId,
  players,
  isHost,
  myId,
  isDuel,
  roleAssign,
  onSave,
}: {
  videoId: string;
  players: PlayerView[];
  isHost: boolean;
  myId: string | null;
  isDuel: boolean;
  // Host's saved casting from the room ({ [playerId]: roles[] }) or null for the
  // automatic default.
  roleAssign: Record<string, number[]> | null;
  onSave: (roleAssign: Record<string, number[]> | null) => void;
}) {
  // Loaded sectors, tagged with the video they belong to so a video switch shows
  // the loading state again without a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ videoId: string; segs: Seg[] } | null>(null);
  const segs = loaded && loaded.videoId === videoId ? loaded.segs : null;

  // Load the video's sectors so we can show the real casting (and know the
  // actual character roles, not just how many). Duel needs none.
  useEffect(() => {
    if (isDuel) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/solo/video/${videoId}`);
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { video: { segments: Seg[] } };
        if (!cancelled) setLoaded({ videoId, segs: d.video.segments });
      } catch {
        if (!cancelled) setLoaded({ videoId, segs: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, isDuel]);

  // The sorted character roles (their real `player` values), labelled P1..PN by
  // position, and the automatic casting expressed as picks.
  const roles = useMemo(() => (segs ? roleList(segs) : []), [segs]);
  const seatKey = players.map((p) => `${p.id}:${p.seat}`).join(",");
  const defaults = useMemo(
    () => (segs ? defaultRoleAssign(segs, players.map((p) => ({ id: p.id, seat: p.seat }))) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, seatKey],
  );

  // What's shown: the host's override if set, else the automatic default. Each
  // player holds AT MOST ONE character, so we read just the first assigned role
  // (the automatic default can hand a player several when there are more
  // characters than players — here we only surface one).
  const effective = roleAssign ?? defaults;
  const roleOf = (id: string): number | null => (effective[id] ?? [])[0] ?? null;

  // Host picks a character for a player. One role per player: choosing a role
  // replaces whatever they had; tapping their current role clears it. We persist
  // the FULL casting (each player capped to their single role) so the studio
  // uses this exact map.
  const toggle = (playerId: string, role: number) => {
    const base: Record<string, number[]> = {};
    for (const p of players) {
      const r = roleOf(p.id);
      base[p.id] = r == null ? [] : [r];
    }
    base[playerId] = roleOf(playerId) === role ? [] : [role];
    onSave(base);
  };

  // How many players share a given character right now (to flag split lines).
  const sharers = (role: number) => players.filter((p) => roleOf(p.id) === role).length;

  return (
    // Pinned like the library's "Trending today" sidebar, but a bit wider so
    // full player names fit. A fixed 380px column on desktop that stays put
    // (sticky, vertically centred) and never grows or shrinks — it stacks
    // full-width only on phones.
    <aside className="lib-trending w-full lg:w-[380px] lg:flex-none">
    <div className="g-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-black uppercase tracking-[0.04em] text-mint">
          Cast the roles
        </h2>
      </div>

      {isDuel ? (
        <p className="text-[13px] leading-[1.5] text-cream/60">
          It&apos;s a duel — everyone dubs the whole video, so there are no roles
          to hand out. May the best voice win.
        </p>
      ) : segs === null ? (
        <p className="text-[13px] leading-[1.5] text-cream/60">Loading characters…</p>
      ) : roles.length === 0 ? (
        <p className="text-[13px] leading-[1.5] text-cream/60">
          This video has no characters to cast.
        </p>
      ) : (
        <>
          {/* Short heads-up on the party-vs-character split. */}
          <p className="mb-3 rounded-[10px] bg-sun/[0.12] px-2.5 py-2 text-[11px] font-bold text-cream/80 shadow-[inset_0_0_0_1px_rgba(255,180,46,0.35)]">
            {players.length === roles.length
              ? `${players.length} players, ${roles.length} characters — one each.`
              : players.length < roles.length
                ? `${players.length} players, ${roles.length} characters — some voice more than one.`
                : `${players.length} players, ${roles.length} characters — you'll share characters.`}
          </p>

          {/* One row per player. */}
          <div className="flex flex-col gap-2">
            {players.map((p) => {
              const myRole = roleOf(p.id);
              const isMe = p.id === myId;
              return (
                <div key={p.id} className="flex items-center gap-2.5 rounded-[10px] bg-white/5 p-2.5">
                  <span
                    className="grid h-8 w-8 flex-none place-items-center rounded-[8px] font-display text-[13px] font-black text-white"
                    style={{ backgroundColor: p.avatarColor }}
                  >
                    {p.displayName.charAt(0).toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate font-display text-[14px] font-bold text-cream">
                      {p.displayName}
                    </span>
                    {isMe && (
                      <span className="rounded-[5px] bg-mint px-1.5 py-0.5 font-display text-[9px] font-black uppercase text-ink">
                        You
                      </span>
                    )}
                  </div>

                  {/* P1 / P2 / P3 — one button per character. A player holds at
                      most one; highlight it, amber when the character is shared
                      by others (its lines get split). Host taps; guests read. */}
                  <div className="flex flex-none gap-1">
                    {roles.map((role, i) => {
                      const here = myRole === role;
                      const shared = here && sharers(role) > 1;
                      return (
                        <button
                          key={role}
                          type="button"
                          disabled={!isHost}
                          onClick={() => toggle(p.id, role)}
                          title={shared ? "Shared — lines split between players" : undefined}
                          className={`grid h-8 w-8 flex-none place-items-center rounded-[8px] font-display text-[12px] font-black transition disabled:cursor-default ${
                            here
                              ? shared
                                ? "bg-sun text-ink ring-2 ring-sun/50"
                                : "bg-mint text-ink"
                              : "bg-white/10 text-cream hover:bg-white/20 disabled:hover:bg-white/10"
                          }`}
                        >
                          P{i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

        </>
      )}
    </div>
    </aside>
  );
}
