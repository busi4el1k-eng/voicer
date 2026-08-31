"use client";

// Cast-the-roles window. A left-hand panel shown on the party pick screen once
// a host has found a video and gathered a party. It lists the players by name
// and, per player, one P-button per character. By DEFAULT it shows exactly what
// the game will do — the automatic sector share-out (lib/party-assign) rendered
// as picks — so every fresh setup starts auto-selected. The host's edits are
// kept ONLY in local state (nothing is persisted while choosing); the pick
// screen sends the final casting to /api/room/select at launch, where it's
// committed for that one game and wiped when the room returns to the lobby.

import { useEffect, useMemo, useState } from "react";
import type { PlayerView } from "@/lib/useRoom";
import { useI18n } from "@/components/LanguageProvider";
import {
  type AssignSeg,
  roleList,
  defaultRoleAssign,
} from "@/lib/party-assign";

type Seg = AssignSeg & { transcript: string };

export function RoleAssignPanel({
  videoId,
  players,
  isHost,
  myId,
  isDuel,
  onChange,
  onValidChange,
}: {
  videoId: string;
  players: PlayerView[];
  isHost: boolean;
  myId: string | null;
  isDuel: boolean;
  // Reports the current casting to the pick screen, which sends it at launch.
  // null means "no manual change" — the game uses the automatic share-out. The
  // casting is NEVER persisted while choosing; it's committed only at Start.
  onChange: (casting: Record<string, number[]> | null) => void;
  // Reports whether the casting is startable: every character has a player and
  // every player has a character. The pick screen blocks launching when false.
  onValidChange?: (valid: boolean) => void;
}) {
  const { t } = useI18n();
  // A character's line count, pluralised via the active locale.
  const lineCount = (n: number) => t(n === 1 ? "cast.lineOne" : "cast.lineMany", { n });
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

  // Every line for each character (in spoken order), so the host can read the
  // whole part behind P1/P2/… — plus a one-line sample for previews/tooltips.
  const roleInfo = useMemo(() => {
    const info = new Map<number, { sample: string; lines: string[] }>();
    if (!segs) return info;
    for (const role of roleList(segs)) {
      const lines = segs
        .filter((s) => (s.player ?? 1) === role && s.endMs > s.startMs)
        .sort((a, b) => a.startMs - b.startMs)
        .map((s) => (s.transcript ?? "").trim());
      const sample = lines.find((t) => !!t) ?? "";
      info.set(role, { sample, lines });
    }
    return info;
  }, [segs]);
  const roleSample = (role: number) => roleInfo.get(role)?.sample ?? "";

  // Which characters' full line lists are expanded (independent accordions).
  const [openRoles, setOpenRoles] = useState<Set<number>>(new Set());
  const toggleOpen = (role: number) =>
    setOpenRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  const seatKey = players.map((p) => `${p.id}:${p.seat}`).join(",");
  const defaults = useMemo(
    () => (segs ? defaultRoleAssign(segs, players.map((p) => ({ id: p.id, seat: p.seat }))) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, seatKey],
  );

  // The host's manual edits for THIS session, kept only in local state — nothing
  // is written to the server while choosing. Tagged with the video+roster it was
  // made for, so it's ignored (treated as untouched) the moment either changes —
  // every fresh setup starts from the system's automatic pick, no reset effect
  // needed. null = untouched (use the automatic default).
  const castKey = `${videoId}|${seatKey}`;
  const [custom, setCustom] = useState<{ key: string; picks: Record<string, number[]> } | null>(
    null,
  );
  const activeCustom = custom && custom.key === castKey ? custom.picks : null;

  // What's shown: the host's edits if any, else the automatic default. A player
  // may voice SEVERAL characters (fewer players than characters), and a character
  // may be shared by SEVERAL players (more players than characters), so picks are
  // per-player arrays.
  const effective = activeCustom ?? defaults;
  const rolesOf = (id: string): number[] => effective[id] ?? [];

  // Host toggles a character on/off for a player. Free-form: adding a role to a
  // player doesn't remove it from anyone else (characters can be shared), and a
  // player can hold as many as you give them. Kept local until launch.
  const toggle = (playerId: string, role: number) => {
    const base: Record<string, number[]> = {};
    for (const p of players) base[p.id] = [...rolesOf(p.id)];
    const has = base[playerId].includes(role);
    base[playerId] = has
      ? base[playerId].filter((r) => r !== role)
      : [...base[playerId], role].sort((a, b) => a - b);
    setCustom({ key: castKey, picks: base });
  };

  // How many players share a given character right now (to flag split lines).
  const sharers = (role: number) => players.filter((p) => rolesOf(p.id).includes(role)).length;

  // Casting is startable only when every character has at least one player AND
  // every player has at least one character — otherwise some lines would be
  // silent or a player would have nothing to dub.
  const unassignedRoles = roles.filter((r) => sharers(r) === 0);
  const idlePlayers = players.filter((p) => rolesOf(p.id).length === 0);
  const ready = segs !== null && unassignedRoles.length === 0 && idlePlayers.length === 0;

  // Report the current casting up so the pick screen can send it at launch. Only
  // the host's edits go up (custom); an untouched panel reports null so the game
  // uses the automatic share-out unchanged. Also report start-validity.
  useEffect(() => {
    onChange(isDuel ? null : activeCustom);
  }, [activeCustom, isDuel, onChange]);
  useEffect(() => {
    onValidChange?.(isDuel || segs === null || ready);
  }, [isDuel, ready, segs, onValidChange]);

  return (
    // Pinned like the library's "Trending today" sidebar, but a bit wider so
    // full player names fit. A fixed 380px column on desktop that stays put
    // (sticky, vertically centred) and never grows or shrinks — it stacks
    // full-width only on phones.
    <aside className="lib-trending w-full lg:w-[380px] lg:flex-none">
    <div className="g-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-black uppercase tracking-[0.04em] text-mint">
          {t("cast.title")}
        </h2>
      </div>

      {isDuel ? (
        <p className="text-[13px] leading-[1.5] text-cream/60">{t("cast.duel")}</p>
      ) : segs === null ? (
        <p className="text-[13px] leading-[1.5] text-cream/60">{t("cast.loading")}</p>
      ) : roles.length === 0 ? (
        <p className="text-[13px] leading-[1.5] text-cream/60">{t("cast.noChars")}</p>
      ) : (
        <>
          {/* Short heads-up on the party-vs-character split. */}
          <p className="mb-3 rounded-[10px] bg-sun/[0.12] px-2.5 py-2 text-[11px] font-bold text-cream/80 shadow-[inset_0_0_0_1px_rgba(255,180,46,0.35)]">
            {t(
              players.length === roles.length
                ? "cast.sizeEqual"
                : players.length < roles.length
                  ? "cast.sizeFewer"
                  : "cast.sizeMore",
              { p: players.length, r: roles.length },
            )}
          </p>

          {/* One row per player. */}
          <div className="flex flex-col gap-2">
            {players.map((p) => {
              const mine = rolesOf(p.id);
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

                  {/* P1 / P2 / P3 — one button per character. A player can hold
                      several; highlight their picks, amber when a character is
                      shared by others (its lines get split). Host taps; guests
                      read. */}
                  <div className="flex flex-none gap-1">
                    {roles.map((role, i) => {
                      const here = mine.includes(role);
                      const shared = here && sharers(role) > 1;
                      return (
                        <button
                          key={role}
                          type="button"
                          disabled={!isHost}
                          onClick={() => toggle(p.id, role)}
                          title={
                            (roleSample(role) ? `P${i + 1}: “${roleSample(role)}”` : `P${i + 1}`) +
                            (shared ? ` · ${t("cast.tipShared")}` : "")
                          }
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

          {/* Warning when the casting can't start — every character needs a
              player and every player needs a character. */}
          {!ready && segs !== null && (
            <div className="mt-3 rounded-[10px] bg-magenta/15 px-2.5 py-2 shadow-[inset_0_0_0_1px_rgba(255,61,139,0.4)]">
              {unassignedRoles.length > 0 && (
                <p className="text-[11px] font-bold leading-[1.4] text-magenta">
                  {t("cast.noVoice", {
                    roles: unassignedRoles.map((r) => `P${roles.indexOf(r) + 1}`).join(", "),
                  })}
                </p>
              )}
              {idlePlayers.length > 0 && (
                <p className="mt-0.5 text-[11px] font-bold leading-[1.4] text-magenta">
                  {t(idlePlayers.length === 1 ? "cast.idleOne" : "cast.idleMany", {
                    names: idlePlayers.map((p) => p.displayName).join(", "),
                  })}
                </p>
              )}
            </div>
          )}

          {/* Character key — tap a P to expand and read that character's full
              set of lines, so the host knows exactly who's behind each pick. */}
          <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
            {roles.map((role, i) => {
              const { sample, lines } = roleInfo.get(role) ?? { sample: "", lines: [] };
              const open = openRoles.has(role);
              return (
                <div key={role} className="rounded-[9px] bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => toggleOpen(role)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                  >
                    <span className="grid h-5 w-6 flex-none place-items-center rounded-[6px] bg-white/10 font-display text-[10px] font-black text-cream">
                      P{i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-cream/55">
                      {open ? lineCount(lines.length) : sample ? `“${sample}”` : lineCount(lines.length)}
                    </span>
                    <span
                      aria-hidden
                      className={`flex-none text-[10px] text-cream/40 transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      ▾
                    </span>
                  </button>
                  {open && (
                    <ol className="max-h-56 space-y-1 overflow-y-auto border-t border-white/10 px-2 py-2">
                      {lines.map((line, idx) => (
                        <li key={idx} className="flex gap-2 text-[11px] leading-[1.4]">
                          <span className="flex-none font-display font-bold text-cream/30">
                            {idx + 1}.
                          </span>
                          <span className="min-w-0 flex-1 text-cream/70">
                            {line || <span className="italic text-cream/30">{t("cast.noText")}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
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
