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
//
// The host can OVERRIDE the automatic casting from the party pick screen (see
// RoleAssignPanel): they hand each character to specific players. When an
// override is supplied it replaces the automatic character→seats grouping; the
// per-role line-splitting for shared characters is identical either way, so the
// two paths stay consistent. A character the host leaves with no seats is left
// un-recorded (keeps the original audio), exactly like an idle seat.

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

// The sorted distinct character roles present in the video (their real `player`
// values, e.g. [1, 2, 3]). The UI labels them P1..PN by position.
export function roleList(segments: AssignSeg[]): number[] {
  return [...new Set(segments.filter(isPlayable).map((s) => s.player ?? 1))].sort(
    (a, b) => a - b,
  );
}

// An override casting: which seats voice each character (role → seat[]). Built
// from the host's per-player picks via roleSeatsFromAssign.
export type RoleSeats = Map<number, number[]>;

// Turn the host's picks (playerId → the character roles that player voices) into
// a role → seats map, using each player's frozen seat. Players without a seat
// (seat 0, i.e. not yet launched) or with no picks are skipped. Result seats are
// de-duplicated and sorted so the line-split is deterministic.
export function roleSeatsFromAssign(
  assign: Record<string, number[]>,
  players: { id: string; seat: number }[],
): RoleSeats {
  const map: RoleSeats = new Map();
  for (const p of players) {
    if (p.seat <= 0) continue;
    for (const role of assign[p.id] ?? []) {
      const seats = map.get(role) ?? [];
      if (!seats.includes(p.seat)) seats.push(p.seat);
      map.set(role, seats);
    }
  }
  for (const [role, seats] of map) map.set(role, [...seats].sort((a, b) => a - b));
  return map;
}

// Split a single character's sectors across the seats voicing it, into
// contiguous, balanced blocks (the shared-character rule). n===1 gives every
// sector to that one seat.
function splitRole(map: Map<string, number>, segs: AssignSeg[], seats: number[]) {
  const n = seats.length;
  if (n === 0) return; // nobody voices this character → left un-recorded
  segs.forEach((s, k) => {
    const gi = Math.min(n - 1, Math.floor((k * n) / segs.length));
    map.set(s.id, seats[gi]);
  });
}

// Map every playable sector → the seat that dubs it. `seats` is the frozen seat
// universe (e.g. [1,2,3]); duplicates/unsorted input are tolerated. Pass
// `override` (role → seats) to use an explicit host casting instead of the
// automatic share-out; seats outside the frozen universe are ignored.
export function assignSectors(
  segments: AssignSeg[],
  seats: number[],
  override?: RoleSeats,
): Map<string, number> {
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

  // Explicit host casting: split each character across exactly the seats it was
  // handed (ignoring any seat that has since left the party). Characters with no
  // valid seat are left un-recorded.
  if (override) {
    const valid = new Set(orderedSeats);
    for (const role of roles) {
      const chosen = (override.get(role) ?? []).filter((s) => valid.has(s));
      splitRole(map, segsByRole.get(role)!, chosen);
    }
    return map;
  }

  // Automatic share-out: build a character → seats grouping, then split.
  const group = new Map<number, number[]>();

  if (P <= R) {
    // Fewer/equal players than characters: each player takes one or more WHOLE
    // characters, round-robin over the roles. When P === R this is a clean 1:1.
    roles.forEach((role, i) => group.set(role, [orderedSeats[i % P]]));
  } else {
    // More players than characters: every character gets at least one player,
    // then the spare players are handed to whichever character currently carries
    // the most lines per player (share the busiest character first) — but never
    // more players than a character has lines.
    const seatsOf: number[][] = roles.map(() => []);
    const spare = [...orderedSeats];
    roles.forEach((_, i) => seatsOf[i].push(spare.shift()!)); // seed one per role
    while (spare.length) {
      let best = -1;
      let bestLoad = -1;
      for (let i = 0; i < R; i++) {
        const size = segsByRole.get(roles[i])!.length;
        if (seatsOf[i].length >= size) continue; // character can't be split further
        const load = size / seatsOf[i].length; // lines per player right now
        if (load > bestLoad) {
          bestLoad = load;
          best = i;
        }
      }
      if (best === -1) break; // every character is at capacity → leftover idle
      seatsOf[best].push(spare.shift()!);
    }
    roles.forEach((role, i) => group.set(role, seatsOf[i]));
  }

  for (const role of roles) splitRole(map, segsByRole.get(role)!, group.get(role)!);
  return map;
}

// The automatic casting expressed as the host's picks would be: playerId → the
// character roles that player voices by default. Feeds the pick-screen panel so
// it shows exactly what the game will do before any manual change.
export function defaultRoleAssign(
  segments: AssignSeg[],
  players: { id: string; seat: number }[],
): Record<string, number[]> {
  const seats = players.map((p) => p.seat);
  const map = assignSectors(segments, seats);
  const bySeat = new Map<number, Set<number>>();
  for (const s of segments) {
    if (!isPlayable(s)) continue;
    const seat = map.get(s.id);
    if (seat == null) continue;
    const role = s.player ?? 1;
    if (!bySeat.has(seat)) bySeat.set(seat, new Set());
    bySeat.get(seat)!.add(role);
  }
  const out: Record<string, number[]> = {};
  for (const p of players) {
    out[p.id] = [...(bySeat.get(p.seat) ?? [])].sort((a, b) => a - b);
  }
  return out;
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
