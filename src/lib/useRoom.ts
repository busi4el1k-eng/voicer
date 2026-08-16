"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRoomCode } from "@/lib/room-code";

export type PlayerView = {
  id: string;
  displayName: string;
  avatarColor: string;
  isHost: boolean;
  seat: number; // 1-based; host = 1
  status: string; // 'playing' | 'finished'
  matchAvg: number | null; // player's avg "match with original" %, null until finished
};
export type RoomView = {
  code: string;
  status: string;
  videoUploadId: string | null;
  finalUrl: string;
  seatCount: number; // players frozen into seats at launch (0 before launch)
  players: PlayerView[];
};

const STORAGE_KEY = "cd_room";
// Safety-net poll interval. Live updates come over SSE (see the effect below);
// this only fires while the stream is NOT connected (reconnecting / unsupported),
// so a healthy client makes ~zero polling requests instead of one every 2.5s.
const POLL_FALLBACK_MS = 8000;
// Fired whenever membership changes so every useRoom instance in the tab (e.g.
// the dashboard's StudioPanel and Lobby) re-reads it immediately — otherwise a
// join/leave in one panel wouldn't reflect in the other until a reload.
const ROOM_EVENT = "cd_room_change";

// Membership snapshots isHost so a returning member can be shown the waiting
// room instantly, before the (possibly slow) room fetch resolves.
type Membership = { code: string; playerId: string; isHost: boolean };

function readMembership(): Membership | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<Membership>;
    if (!m.code || !m.playerId) return null;
    return { code: m.code, playerId: m.playerId, isHost: m.isHost ?? false };
  } catch {
    return null;
  }
}

// Client-side room state: the caller's identity (name/colour from the
// dashboard), the joined room, live-polled player list, and create/join/leave
// actions. Membership survives reloads via localStorage and is shared across
// hook instances in the same tab via a window event.
export function useRoom(me: { displayName: string; avatarColor: string }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  // False until the mount effect has read localStorage. Guards must wait for
  // this before treating "no membership" as "not in a room" — otherwise the
  // first render (membership still null) would wrongly look room-less.
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef(me);
  meRef.current = me;

  const playerId = membership?.playerId ?? null;

  const persist = useCallback((m: Membership | null) => {
    try {
      if (m) localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore storage errors (private mode etc.) */
    }
    // Let sibling hook instances in this tab re-sync right away.
    try {
      window.dispatchEvent(new Event(ROOM_EVENT));
    } catch {
      /* SSR / no window */
    }
  }, []);

  const reset = useCallback(() => {
    setRoom(null);
    setMembership(null);
    persist(null);
  }, [persist]);

  // Adopt a membership (from storage or a sibling instance) and load its room.
  const applyMembership = useCallback(
    (m: Membership | null) => {
      setMembership(m);
      if (!m) {
        setRoom(null);
        return;
      }
      fetch(`/api/room/${m.code}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { room?: RoomView } | null) => {
          if (!d?.room) return;
          // Room exists but we're not in its roster (closed & recycled, kicked,
          // pruned): the stored membership is stale, so drop it.
          if (d.room.players.some((p) => p.id === m.playerId)) setRoom(d.room);
          else reset();
        })
        .catch((status) => {
          if (status === 404) reset(); // room closed — drop the stale membership
        });
    },
    [reset],
  );

  // Rehydrate on mount, and stay in sync with joins/leaves from sibling
  // instances (same tab via ROOM_EVENT) and other tabs (storage event).
  useEffect(() => {
    applyMembership(readMembership());
    setHydrated(true);
    const onChange = () => applyMembership(readMembership());
    window.addEventListener(ROOM_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ROOM_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [applyMembership]);

  // Stay in sync while we have a membership (not just a loaded room) so
  // joins/leaves show up for everyone, a room that failed to load initially
  // keeps retrying, and a dead/stale membership self-heals.
  //
  // Primary transport is SSE (server pushes on every change) instead of the old
  // constant polling — that was the app's main scaling bottleneck. A slow poll
  // stays as a safety net but only fires while the stream is disconnected.
  useEffect(() => {
    const code = membership?.code;
    if (!code) return;
    let cancelled = false;

    const applyRoom = (room: RoomView | null | undefined) => {
      if (cancelled || !room) return;
      // Still in the roster → sync; otherwise the room recycled without us.
      if (room.players.some((p) => p.id === playerId)) setRoom(room);
      else reset();
    };

    const fetchOnce = () => {
      fetch(`/api/room/${code}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { room?: RoomView } | null) => applyRoom(d?.room))
        .catch((status) => {
          if (!cancelled && status === 404) reset(); // room closed by host
        });
    };

    // Server-pushed updates. EventSource auto-reconnects on error; on each frame
    // we get either the fresh room or a "closed" signal (host ended the room).
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/room/${code}/stream`);
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as { room?: RoomView; closed?: boolean };
          if (d.closed) {
            if (!cancelled) reset();
            return;
          }
          applyRoom(d.room);
        } catch {
          /* ignore malformed frame */
        }
      };
    } catch {
      es = null; // SSE unsupported → the fallback poll below carries the load
    }

    // Immediate snapshot (in case the stream is slow to connect) + safety poll
    // that only runs when the stream isn't OPEN (readyState 1).
    fetchOnce();
    const id = setInterval(() => {
      if (!es || es.readyState !== 1) fetchOnce();
    }, POLL_FALLBACK_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      es?.close();
    };
  }, [membership?.code, playerId, reset]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(meRef.current),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create the room.");
      setRoom(data.room);
      const m: Membership = { code: data.room.code, playerId: data.playerId, isHost: true };
      setMembership(m);
      persist(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the room.");
    } finally {
      setBusy(false);
    }
  }, [persist]);

  const join = useCallback(
    async (rawCode: string) => {
      const code = normalizeRoomCode(rawCode);
      if (!code) {
        setError("Enter a room code.");
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/room/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...meRef.current, code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Couldn't join the room.");
        setRoom(data.room);
        const m: Membership = { code: data.room.code, playerId: data.playerId, isHost: false };
        setMembership(m);
        persist(m);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't join the room.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [persist],
  );

  // Host-only: flip the room to "playing" so waiting members follow into the
  // game. Returns true once the server confirms.
  const start = useCallback(async (): Promise<boolean> => {
    if (!room || !playerId) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: room.code, playerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't start the party.");
      setRoom(data.room);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the party.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [room, playerId]);

  const leave = useCallback(async () => {
    // Always clear local membership first — even if the room never loaded or no
    // longer exists — so the user is never trapped and can immediately re-enter.
    const code = room?.code ?? membership?.code ?? null;
    const pid = playerId;
    reset();
    if (!code || !pid) return;
    try {
      await fetch("/api/room/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, playerId: pid }),
      });
    } catch {
      /* local state already cleared */
    }
  }, [room, membership, playerId, reset]);

  // Host-only: end the current game but keep the party together. `target`
  // "lobby" returns everyone to the waiting room; "playing" jumps straight to
  // picking a new video. Members follow automatically via the live stream.
  const restart = useCallback(
    async (target: "lobby" | "playing" = "lobby"): Promise<boolean> => {
      const code = room?.code ?? membership?.code ?? null;
      if (!code || !playerId) return false;
      try {
        const res = await fetch("/api/room/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, playerId, target }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.room) setRoom(data.room);
        return true;
      } catch {
        return false;
      }
    },
    [room, membership, playerId],
  );

  // Authoritative host flag once the room is loaded; before that, fall back to
  // the membership snapshot so the UI (e.g. the waiting room) is correct
  // instantly. `inRoom` is optimistic for the same reason.
  const isHost = room
    ? room.players.find((p) => p.id === playerId)?.isHost === true
    : (membership?.isHost ?? false);
  const inRoom = !!membership || !!room;

  return {
    room,
    playerId,
    inRoom,
    isHost,
    hydrated,
    busy,
    error,
    setError,
    create,
    join,
    start,
    restart,
    leave,
  };
}
