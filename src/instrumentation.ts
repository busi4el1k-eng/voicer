// Runs once when a Next.js server instance starts. We use it to launch the
// in-process music-bed worker (Node runtime only — never the edge runtime),
// which generates Demucs beds for pending uploads in the background so renders
// always have the original dialogue removed regardless of video size.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBedWorker } = await import("@/lib/bed-worker");
  startBedWorker();
  // De-fragment + faststart source videos so iOS can seek per-sector (see
  // normalize.server.ts). Backfills existing uploads and catches any whose
  // upload-time normalize didn't run.
  const { startNormalizeWorker } = await import("@/lib/normalize-worker");
  startNormalizeWorker();
  // Cross-instance room events via Redis (no-op unless Upstash is configured).
  const { startRoomEvents } = await import("@/lib/room-events");
  startRoomEvents();
}
