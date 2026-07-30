// In-memory rate limiter, lifted from ../digital_standarts/src/lib/rate-limit.ts.
// Process-local — fine for single-instance API and the socket server.
interface Entry {
  count: number;
  windowEnd: number;
  blockedUntil?: number;
}

const store = new Map<string, Entry>();

// Cleanup stale entries every 10 minutes to avoid memory leaks.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.windowEnd < now && (!entry.blockedUntil || entry.blockedUntil < now)) {
      store.delete(key);
    }
  }
}, 10 * 60 * 1000);

interface Options {
  maxRequests: number; // max hits per window
  windowMs: number; // rolling window duration
  blockMs?: number; // how long to block after exceeding (default: same as window)
}

export function rateLimit(key: string, opts: Options): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const blockMs = opts.blockMs ?? opts.windowMs;
  const entry = store.get(key);

  if (entry?.blockedUntil && entry.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  if (!entry || entry.windowEnd < now) {
    store.set(key, { count: 1, windowEnd: now + opts.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  entry.count++;

  if (entry.count > opts.maxRequests) {
    entry.blockedUntil = now + blockMs;
    return { allowed: false, retryAfterSec: Math.ceil(blockMs / 1000) };
  }

  return { allowed: true, retryAfterSec: 0 };
}
