// Pure room-code helpers — safe to import from client or server (no db here;
// the db-backed unique generator lives in room.server.ts). Mirrors share-id.ts
// but uses the shorter 4-char code the Room model is keyed on.

import { SHARE_ID_ALPHABET } from "@/lib/share-id";

export const ROOM_CODE_LENGTH = 4;
export const MAX_PLAYERS = 4; // host + up to 3 others
export const MIN_PLAYERS = 2; // party mode needs at least two players to start

export function randomRoomCode(): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += SHARE_ID_ALPHABET[Math.floor(Math.random() * SHARE_ID_ALPHABET.length)];
  }
  return out;
}

// Strip a room code down to its stored form: uppercase, alphanumeric, capped at
// the code length.
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH);
}
