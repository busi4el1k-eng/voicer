// "Play as guest" for a signed-in player. Clicking it sets this cookie, which
// makes the server treat the request as a guest (getOrCreateUser returns null)
// even though a Clerk session exists. The choice has to survive navigation from
// the dashboard into /creator and /play, so a query param won't do — hence a
// cookie. It's a UX preference, not a security boundary, so the client sets it
// directly (no httpOnly needed).

export const GUEST_COOKIE = "cd_guest";

// Client-only helpers. Safe to import into client components; they touch
// `document` only when actually invoked from an event handler.
export function setPlayAsGuest() {
  document.cookie = `${GUEST_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
}

export function clearPlayAsGuest() {
  document.cookie = `${GUEST_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
