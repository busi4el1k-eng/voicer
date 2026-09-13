import "server-only";
import { sweepUnnormalizedSources } from "@/lib/normalize.server";

// In-process background worker that de-fragments + faststart-remuxes any source
// video that still needs it (see normalize.server.ts). Runs inside the app's Node
// process (started from instrumentation.ts), off the HTTP request path — so it
// backfills the whole existing library after deploy, and catches any upload whose
// `after()` normalize didn't run (restart/misconfig), regardless of video size.
//
// One source per pass; loops promptly while there's a backlog, otherwise idles.
// Unlike the bed worker this is NOT gated on Demucs — it must run everywhere.

const IDLE_INTERVAL_MS = 60_000; // wait this long when there's nothing to do
const BUSY_INTERVAL_MS = 4_000; // brief pause between items when catching up
const START_DELAY_MS = 15_000; // let the server settle before the first pass

let started = false;

export function startNormalizeWorker(): void {
  if (started) return; // register() can fire more than once per process
  started = true;

  const tick = async () => {
    let didWork = false;
    try {
      didWork = await sweepUnnormalizedSources();
    } catch (e) {
      console.error("[normalize-worker] sweep failed:", e);
    }
    setTimeout(tick, didWork ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
  };

  console.log("[normalize-worker] started");
  setTimeout(tick, START_DELAY_MS);
}
