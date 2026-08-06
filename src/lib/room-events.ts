import "server-only";
import { EventEmitter } from "node:events";

// Pub/sub for room changes. A mutation route calls emitRoom(code) right after
// its DB write; every open SSE stream for that room (see
// /api/room/[code]/stream) re-reads and pushes the fresh state to its clients —
// so the game updates instantly without the old 2.5s polling.
//
// Two layers:
//  1. An in-process EventEmitter delivers events to SSE streams on THIS process
//     instantly (works with zero external services).
//  2. If Upstash Redis is configured, emitRoom ALSO publishes the code to a
//     shared channel, and one subscriber per process re-emits codes it receives
//     from OTHER instances into the local bus. That's what makes events cross
//     processes once the app runs on multiple instances — without it, a change
//     on instance A would never reach a client connected to instance B.
//
// Publishing is fire-and-forget: if Redis is slow or down, local delivery is
// unaffected and other instances simply miss that one event.

const g = globalThis as unknown as {
  __cdRoomBus?: EventEmitter;
  __cdRedisStarted?: boolean;
};

const bus = g.__cdRoomBus ?? new EventEmitter();
bus.setMaxListeners(0); // many rooms × many client streams
g.__cdRoomBus = bus;

const eventKey = (code: string) => `room:${code}`;

// Shared Redis channel + a per-process id so we can ignore our own publishes
// (they were already delivered locally by emitRoom).
const CHANNEL = "cd-room-events";
const REST_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const redisReady = !!(REST_URL && REST_TOKEN);
const INSTANCE = Math.random().toString(36).slice(2, 10);

// Signal that a room changed. Delivers locally now, and fans out to other
// instances via Redis when configured.
export function emitRoom(code: string): void {
  bus.emit(eventKey(code));
  if (redisReady) void publishToRedis(code);
}

// Subscribe to a room's changes; returns an unsubscribe function.
export function subscribeRoom(code: string, cb: () => void): () => void {
  const k = eventKey(code);
  bus.on(k, cb);
  return () => {
    bus.off(k, cb);
  };
}

async function publishToRedis(code: string): Promise<void> {
  try {
    const msg = encodeURIComponent(`${INSTANCE}:${code}`);
    await fetch(`${REST_URL}/publish/${CHANNEL}/${msg}`, {
      headers: { Authorization: `Bearer ${REST_TOKEN}` },
      cache: "no-store",
    });
  } catch {
    /* Redis unreachable — other instances miss this one event; local is fine */
  }
}

// Start the single per-process subscriber that turns cross-instance Redis
// messages back into local events. Idempotent; a no-op without Redis. Called
// from instrumentation.ts at server startup (never during build).
export function startRoomEvents(): void {
  if (!redisReady || g.__cdRedisStarted) return;
  g.__cdRedisStarted = true;

  const run = async () => {
    for (;;) {
      try {
        const res = await fetch(`${REST_URL}/subscribe/${CHANNEL}`, {
          headers: { Authorization: `Bearer ${REST_TOKEN}`, Accept: "text/event-stream" },
          cache: "no-store",
        });
        if (!res.body) throw new Error("no stream body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            // Upstash SSE payload: "message,<channel>,<our-message>"
            const parts = line.slice(5).trim().split(",");
            if (parts[0] !== "message") continue;
            const [inst, code] = parts.slice(2).join(",").split(":");
            if (!code || inst === INSTANCE) continue; // skip our own publishes
            bus.emit(eventKey(code)); // deliver the remote change locally
          }
        }
      } catch {
        /* connection dropped or Redis hiccup — reconnect below */
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
  void run();
  console.log("[room-events] Redis fan-out started");
}
