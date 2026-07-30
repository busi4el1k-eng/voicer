// Tiny classnames joiner. Avoids a dep for the handful of conditional classes we use.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
