import "server-only";
import { sweepPendingBeds } from "@/lib/bed.server";

// In-process background worker that keeps generating Demucs music beds for any
// upload that still needs one. Runs inside the app's Node process (started from
// instrumentation.ts), completely off the HTTP request path — so a bed for a
// huge video takes as long as it takes without ever hitting a request/proxy
// timeout. That's what makes bed generation reliable regardless of video size.
//
// It processes one upload per pass (Demucs handles a single job at a time); when
// there's a backlog it loops again promptly, otherwise it idles between passes.

const IDLE_INTERVAL_MS = 60_000; // wait this long when there's nothing to do
const BUSY_INTERVAL_MS = 3_000; // brief pause between items when catching up
const START_DELAY_MS = 10_000; // let the server settle before the first pass

let started = false;

export function startBedWorker(): void {
  if (started) return; // register() can fire more than once per process
  started = true;

  const tick = async () => {
    let didWork = false;
    try {
      didWork = await sweepPendingBeds();
    } catch (e) {
      console.error("[bed-worker] sweep failed:", e);
    }
    setTimeout(tick, didWork ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
  };

  console.log("[bed-worker] started");
  setTimeout(tick, START_DELAY_MS);
}
