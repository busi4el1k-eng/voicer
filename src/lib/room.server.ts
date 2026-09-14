import "server-only";
import db from "@/lib/db";
import { randomRoomCode } from "@/lib/room-code";
import { chainOrder } from "@/lib/telephone";

// Abandoned rooms are never explicitly closed (a host who just shuts the tab
// leaves the row behind), so we sweep any room older than this on create. The
// 4-char code space is only ~923k, so letting dead rooms accumulate would
// eventually saturate it; a generous TTL avoids ever culling a live party.
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // 12h
// Cap how often the sweep actually runs (per process) so a burst of room
// creates doesn't fire a deleteMany on every request.
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = 0;

// Thrown when the code space is genuinely exhausted. With pruneStaleRooms in
// place this should never happen; we surface it as a clean 503 rather than
// emitting an over-length, un-joinable code (see generateRoomCode).
export class RoomCodeExhaustedError extends Error {
  constructor() {
    super("Couldn't allocate a room code.");
    this.name = "RoomCodeExhaustedError";
  }
}

// Delete rooms older than ROOM_TTL_MS. Cascades to their players and takes;
// PlayerRating rows are deliberately not cascaded, so scores survive. Throttled
// in-process and best-effort — a failed sweep must never block room creation.
export async function pruneStaleRooms(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const cutoff = new Date(now - ROOM_TTL_MS);
  await db.room.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
}

// Generate a room code that isn't already an active room. Retry on the
// (astronomically unlikely) collision. If every attempt collides the space is
// saturated — throw rather than return a longer code, because the rest of the
// app assumes exactly ROOM_CODE_LENGTH chars and normalizeRoomCode() would
// truncate anything longer into a code that no longer matches its own room.
export async function generateRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomRoomCode();
    const existing = await db.room.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new RoomCodeExhaustedError();
}

export type PlayerView = {
  id: string;
  displayName: string;
  avatarColor: string;
  isHost: boolean;
  seat: number; // 1-based; host = 1, joiners in join order
  status: string; // 'playing' | 'finished'
  matchAvg: number | null; // player's avg "match with original" %, null until finished
  finalUrl: string; // DUEL: this player's own rendered dub ("" until rendered / in party)
};

export type RoomView = {
  code: string;
  status: string;
  mode: string; // 'party' | 'duel' | 'telephone'
  videoUploadId: string | null;
  finalUrl: string;
  // Players frozen into seats when the current game launched (0 before launch).
  // The sector→seat assignment uses [1..seatCount] so it's stable across leaves.
  seatCount: number;
  // Host's manual character casting: { [playerId]: roles[] }, or null for the
  // automatic share-out. Drives who dubs which character in the studio.
  roleAssign: Record<string, number[]> | null;
  players: PlayerView[];
  // ── Telephone Chain live state (all null/0 in party/duel) ──────────────────
  // The chain walks the whole video one sector at a time; exactly one player is
  // "up" at once. These let every client show "{name} is dubbing sector a/b" and
  // hand the active player the ONE thing they're allowed to hear.
  currentSeat: number | null; // whose turn it is now (null once the chain is done)
  currentSegmentId: string | null; // the sector being dubbed now
  chainTotal: number; // total turns = playable sectors (0 when not telephone)
  chainDone: number; // turns completed so far (= the round cursor)
  previousTakeUrl: string | null; // the previous player's take — the only cue the active player gets
};

// Coerce the loosely-typed Room.roleAssign JSON into a clean
// { [playerId]: number[] } map, dropping anything malformed. Returns null when
// there's no override (→ automatic casting).
export function normalizeRoleAssign(raw: unknown): Record<string, number[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number[]> = {};
  for (const [id, roles] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(roles)) continue;
    const nums = roles.filter((r): r is number => typeof r === "number" && Number.isInteger(r));
    out[id] = [...new Set(nums)].sort((a, b) => a - b);
  }
  return Object.keys(out).length ? out : null;
}

// The public shape of a room: its status, the chosen video / rendered result,
// plus the ordered player list (host first, then join order). Seat is derived
// from that ordering. Returns null if the room no longer exists.
export async function roomView(code: string): Promise<RoomView | null> {
  const room = await db.room.findUnique({
    where: { code },
    include: { players: { orderBy: [{ isHost: "desc" }, { createdAt: "asc" }] } },
  });
  if (!room) return null;

  // Telephone Chain: derive the live cursor from the same pure turn order the
  // submit/skip routes validate against, and surface the previous take (the only
  // audio the active player may hear). Only touch the DB for telephone rooms so
  // party/duel views stay a single query.
  let currentSeat: number | null = null;
  let currentSegmentId: string | null = null;
  let chainTotal = 0;
  let chainDone = 0;
  let previousTakeUrl: string | null = null;
  if (room.mode === "telephone" && room.videoUploadId) {
    const segs = await db.videoSegment.findMany({
      where: { uploadId: room.videoUploadId },
      select: { id: true, startMs: true, endMs: true },
    });
    const seatUniverse = room.seatCount > 0 ? room.seatCount : room.players.length;
    const turns = chainOrder(segs, seatUniverse);
    chainTotal = turns.length;
    chainDone = Math.min(room.round, chainTotal);
    if (room.round < chainTotal) {
      currentSeat = turns[room.round].seat;
      currentSegmentId = turns[room.round].segmentId;
    }
    // The player at turn N hears turn N-1's dub. On the very first turn (or when
    // the previous turn was skipped and left no take) there's nothing to hear.
    if (room.round > 0 && room.round - 1 < chainTotal) {
      const prev = await db.roomTake.findUnique({
        where: {
          roomCode_segmentId: { roomCode: code, segmentId: turns[room.round - 1].segmentId },
        },
        select: { partUrl: true },
      });
      previousTakeUrl = prev?.partUrl ?? null;
    }
  }

  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    videoUploadId: room.videoUploadId,
    finalUrl: room.finalUrl,
    seatCount: room.seatCount,
    roleAssign: normalizeRoleAssign(room.roleAssign),
    currentSeat,
    currentSegmentId,
    chainTotal,
    chainDone,
    previousTakeUrl,
    players: room.players.map((p, i) => ({
      id: p.id,
      displayName: p.displayName,
      avatarColor: p.avatarColor,
      isHost: p.isHost,
      // Once the game has started each player carries a frozen seat (set in
      // select). In the lobby it's still 0, so fall back to roster position.
      seat: p.seat > 0 ? p.seat : i + 1,
      status: p.status,
      matchAvg: p.matchAvg,
      finalUrl: p.finalUrl,
    })),
  };
}
