// Runs once when a Next.js server instance starts. We use it to launch the
// in-process music-bed worker (Node runtime only — never the edge runtime),
// which generates Demucs beds for pending uploads in the background so renders
// always have the original dialogue removed regardless of video size.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBedWorker } = await import("@/lib/bed-worker");
  startBedWorker();
}
