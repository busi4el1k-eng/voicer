// Party sector assignment — the single source of truth for "who dubs what".
//
// A video's sectors each carry a `player` (1..R) = the CHARACTER role the
// creator cast them into. A room has P players sitting in frozen seats (1..P,
// set in /api/room/select). These two counts need not match, and this module
// maps every playable sector to exactly one seat for ANY P and R:
//
//   • P === R → one whole character per player (the creator's intended casting)
//   • P <  R → a player voices several whole characters (round-robin by role),
//              e.g. 2 players / 3 characters → P1 voices characters 1 & 3.
//   • P >  R → a character is shared by several players; its lines are split
//              into contiguous blocks, e.g. 3 players / 1 character → the lines
//              are divided three ways.
//
// The mapping is PURE and DETERMINISTIC: the studio (client) uses it to decide
// what to record, the submit route (server) uses it to validate ownership, and
// both must agree. Given the same sectors and the same seat list they always
// produce the same Map. Callers pass the frozen seat universe [1..seatCount] so
// a mid-game leave never changes anyone's assignment (a departed seat's sectors
// simply go un-recorded and keep the original audio at render time).

export type AssignSeg = {
  id: string;
  player: number | null;
  startMs: number;
  endMs: number;
};

// A sector is playable only if it has real duration; zero-length cut points are
// ignored everywhere.
const isPlayable = (s: AssignSeg) => s.endMs > s.startMs;

// Stable order so every caller walks sectors identically: by start time, then id
// as a tiebreaker for sectors that begin at the same instant.
const byStart = (a: AssignSeg, b: AssignSeg) =>
  a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Distinct character roles present in the video (ascending). This is the
// "recommended players" number the creator effectively asked for.
export function roleCount(segments: AssignSeg[]): number {
  return new Set(segments.filter(isPlayable).map((s) => s.player ?? 1)).size;
}

// Map every playable sector → the seat that dubs it. `seats` is the frozen seat
// universe (e.g. [1,2,3]); duplicates/unsorted input are tolerated.
export function assignSectors(segments: AssignSeg[], seats: number[]): Map<string, number> {
  const map = new Map<string, number>();
  const playable = segments.filter(isPlayable).slice().sort(byStart);
  const orderedSeats = [...new Set(seats)].sort((a, b) => a - b);
  const P = orderedSeats.length;
  if (P === 0 || playable.length === 0) return map;

  const roles = [...new Set(playable.map((s) => s.player ?? 1))].sort((a, b) => a - b);
  const R = roles.length;
  const segsByRole = new Map<number, AssignSeg[]>();
  for (const role of roles) {
    segsByRole.set(role, playable.filter((s) => (s.player ?? 1) === role));
  }

  if (P <= R) {
    // Fewer/equal players than characters: each player takes one or more WHOLE
    // characters, round-robin over the roles. When P === R this is a clean 1:1.
    roles.forEach((role, i) => {
      const seat = orderedSeats[i % P];
      for (const s of segsByRole.get(role)!) map.set(s.id, seat);
    });
    return map;
  }

  // More players than characters: every character gets at least one player, then
  // the spare players are handed to whichever character currently carries the
  // most lines per player (share the busiest character first) — but never more
  // players than a character has lines. Each character's lines are then split
  // into contiguous, balanced blocks across its players.
  const group: number[][] = roles.map(() => []); // seats sharing each role
  const spare = [...orderedSeats];
  roles.forEach((_, i) => group[i].push(spare.shift()!)); // seed one per role
  while (spare.length) {
    let best = -1;
    let bestLoad = -1;
    for (let i = 0; i < R; i++) {
      const size = segsByRole.get(roles[i])!.length;
      if (group[i].length >= size) continue; // character can't be split further
      const load = size / group[i].length; // lines per player right now
      if (load > bestLoad) {
        bestLoad = load;
        best = i;
      }
    }
    if (best === -1) break; // every character is at capacity → leftover idle
    group[best].push(spare.shift()!);
  }
  roles.forEach((role, i) => {
    const segs = segsByRole.get(role)!;
    const seatsForRole = group[i];
    const n = seatsForRole.length;
    segs.forEach((s, k) => {
      const gi = Math.min(n - 1, Math.floor((k * n) / segs.length));
      map.set(s.id, seatsForRole[gi]);
    });
  });
  return map;
}

// How many seats share each character (role → number of players voicing it).
// Used to explain the split to players ("3 people voice this character").
export function seatsPerRole(segments: AssignSeg[], seats: number[]): Map<number, number> {
  const map = assignSectors(segments, seats);
  const roleSeats = new Map<number, Set<number>>();
  for (const s of segments) {
    if (!isPlayable(s)) continue;
    const seat = map.get(s.id);
    if (seat == null) continue;
    const role = s.player ?? 1;
    if (!roleSeats.has(role)) roleSeats.set(role, new Set());
    roleSeats.get(role)!.add(seat);
  }
  return new Map([...roleSeats].map(([role, set]) => [role, set.size]));
}
