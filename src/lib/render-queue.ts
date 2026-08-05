import "server-only";
import { ClientError } from "@/lib/errors";

// Global concurrency limiter for the CPU/RAM-heavy final render (muxDub).
//
// The host has only ~2 shared vCPUs and no memory headroom to spare: every
// render spawns an ffmpeg process AND loads the whole source video into RAM.
// Letting every "export dub" / "finish game" click run at once is exactly what
// saturates the CPU (renders crawl, the polling API stalls for everyone) and, on
// a big video, risks an OOM. This caps how many renders run simultaneously;
// the rest wait their turn. Acquire the slot BEFORE loading the source buffer so
// queued renders don't each pin hundreds of MB in memory while waiting.
//
// Tunable without a redeploy via env:
//   RENDER_MAX_CONCURRENCY  how many renders may run at once (default 2)
//   RENDER_MAX_QUEUE        how many may wait before new ones are rejected (default 8)

const MAX_CONCURRENT = Math.max(1, Number(process.env.RENDER_MAX_CONCURRENCY ?? 2));
const MAX_QUEUED = Math.max(0, Number(process.env.RENDER_MAX_QUEUE ?? 8));

// Thrown when the queue is already full. Extends ClientError so its (safe)
// message reaches the user; routes map it to HTTP 503 so the client can retry.
export class RenderBusyError extends ClientError {
  constructor() {
    super("The server is busy finishing other videos right now. Please try again in a moment.");
    this.name = "RenderBusyError";
  }
}

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUED) {
    return Promise.reject(new RenderBusyError());
  }
  // Park until a slot is handed over (see release). The slot count doesn't
  // change on handoff — one render leaves, this one takes its place.
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand our slot straight to the next waiter; `active` unchanged
  else active--; // no one waiting — free the slot
}

// Run `task` under the render concurrency limit. Rejects with RenderBusyError
// (without running the task) if too many renders are already queued.
export async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}
