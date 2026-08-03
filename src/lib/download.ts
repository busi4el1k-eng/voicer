// Build a same-origin URL that force-downloads a Spaces object (via
// /api/download) instead of opening it in a new tab. `filename` is what the
// browser saves the file as.
export function downloadHref(url: string, filename: string): string {
  return `/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`;
}
