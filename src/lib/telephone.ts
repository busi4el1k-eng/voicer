// Telephone Chain turn order — the single source of truth for "whose turn is it,
// and on which sector". The mode plays the whole video as ONE sequential chain:
// sectors are walked in timeline order and handed round-robin to the frozen
// seats [1..seatCount], so turn k dubs the k-th sector and hears ONLY the take
// from turn k-1 (never the original script). One take per sector, exactly like a
// party dub — which is why Telephone reuses RoomTake and the party render path
// rather than a new table (contrast DuelTake, which stores many takes per
// sector).
//
// Room.round is the live cursor: the index of the turn being dubbed right now.
// It advances by exactly one on every submit/skip (a compare-and-swap on the
// column serialises concurrent submits). When round >= turns.length the chain is
// complete and the room is ready to render.
//
// This mapping is PURE and DETERMINISTIC — the room view (to expose the current
// seat + previous take), the submit route (to validate it's really your turn),
// and the skip route all derive it from the same (segments, seatCount) inputs
// and therefore always agree, with no extra state to persist. Mirrors the
// contract of lib/party-assign's assignSectors.

export type ChainSeg = { id: string; startMs: number; endMs: number };

// One turn in the chain: `order` is its position (0-based), `segmentId` the
// sector dubbed, `seat` the frozen seat (1-based) whose turn it is.
export type ChainTurn = { order: number; segmentId: string; seat: number };

// A sector is only dubbable if it has real duration; zero-length cut points are
// ignored everywhere (same rule as party-assign).
const isPlayable = (s: ChainSeg) => s.endMs > s.startMs;

// Stable order so every caller walks sectors identically: by start time, then id
// as a tiebreaker for sectors that begin at the same instant.
const byStart = (a: ChainSeg, b: ChainSeg) =>
  a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The ordered list of turns for a video: every playable sector in timeline order,
// each assigned to a seat round-robin over [1..seatCount]. With one player it's a
// solo chain (each turn hears its own previous take); with more, the mic passes
// player to player down the video. `seatCount` falls back to 1 so a room that
// predates the frozen seat count never produces an empty chain.
export function chainOrder(segments: ChainSeg[], seatCount: number): ChainTurn[] {
  const seats = seatCount > 0 ? seatCount : 1;
  return segments
    .filter(isPlayable)
    .slice()
    .sort(byStart)
    .map((s, i) => ({ order: i, segmentId: s.id, seat: (i % seats) + 1 }));
}
