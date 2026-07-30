// Pure share-code helpers — safe to import from client or server (no db here;
// the db-backed uniqueness generator lives in share-id.server.ts).

// Human-friendly share codes: uppercase letters + digits, minus the ambiguous
// ones (0/O, 1/I/L) so a code is easy to read out loud and type.
export const SHARE_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SHARE_ID_LENGTH = 8; // displayed as XXXX-XXXX

export function randomShareCode(): string {
  let out = "";
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    out += SHARE_ID_ALPHABET[Math.floor(Math.random() * SHARE_ID_ALPHABET.length)];
  }
  return out;
}

// Strip a code down to its stored form: uppercase, alphanumeric only, capped at
// the code length. Accepts the pretty "XXXX-XXXX" form or raw input.
export function normalizeShareCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, SHARE_ID_LENGTH);
}

// Pretty form for display: "XXXX-XXXX" (a dash after the first 4 chars). Purely
// cosmetic — strip the dash before looking a code up.
export function formatShareId(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// Format live user input into the pretty, dashed form as they type.
export function formatShareInput(raw: string): string {
  return formatShareId(normalizeShareCode(raw));
}
