import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

// Reactions on a "Clips of Today" podium clip: ❤️ (heart) and 🍅 (tomato).
// Unlimited — a viewer can tap as many times as they like — so we keep a running
// counter per (clip, kind). Taps are batched by the client into a `delta`; the
// server applies it and returns the fresh totals.
//
// Anti-bot: a per-viewer sliding-window rate limit clamps how many reactions can
// land in a short window, so a human mashing the button flows through but a
// script can't inflate the count. Enforced in-memory (per server instance),
// keyed by client id + IP so clearing localStorage doesn't fully reset it.

const KINDS = ["heart", "tomato"] as const;
type Kind = (typeof KINDS)[number];
const isKind = (v: unknown): v is Kind => KINDS.includes(v as Kind);

const PER_REQUEST_MAX = 20; // most taps we'll honour from a single request
const WINDOW_MS = 10_000; // sliding window length
const WINDOW_MAX = 60; // most reactions one viewer can land per window

// viewerKey → { windowStart, used }. Pruned lazily on access + when it grows.
const buckets = new Map<string, { start: number; used: number }>();

// How many reactions this viewer may still land right now (0 = throttled).
function allowance(viewerKey: string, want: number): number {
  const now = Date.now();
  let b = buckets.get(viewerKey);
  if (!b || now - b.start >= WINDOW_MS) {
    b = { start: now, used: 0 };
    buckets.set(viewerKey, b);
  }
  const remaining = Math.max(0, WINDOW_MAX - b.used);
  const grant = Math.min(want, remaining);
  b.used += grant;
  // Keep the map from growing without bound on a busy server.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.start >= WINDOW_MS) buckets.delete(k);
  }
  return grant;
}

// Live totals for a clip: { heart, tomato }.
async function counts(clipId: string): Promise<Record<Kind, number>> {
  const rows = await db.clipReaction.findMany({
    where: { clipId },
    select: { kind: true, count: true },
  });
  const out: Record<Kind, number> = { heart: 0, tomato: 0 };
  for (const r of rows) if (isKind(r.kind)) out[r.kind] = r.count;
  return out;
}

// GET /api/clip/react?clipId=... → { counts }
export async function GET(req: NextRequest) {
  const clipId = new URL(req.url).searchParams.get("clipId") ?? "";
  if (!clipId) return NextResponse.json({ error: "Missing clip." }, { status: 400 });
  return NextResponse.json({ counts: await counts(clipId) });
}

// POST /api/clip/react { clipId, kind, delta?, reactorKey? } → { counts, accepted }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    clipId?: string;
    kind?: unknown;
    delta?: unknown;
    reactorKey?: string;
  };
  const clipId = body.clipId ?? "";
  if (!clipId) return NextResponse.json({ error: "Missing clip." }, { status: 400 });
  if (!isKind(body.kind)) {
    return NextResponse.json({ error: "Invalid reaction." }, { status: 400 });
  }
  const kind = body.kind;

  const want = Math.max(1, Math.min(PER_REQUEST_MAX, Math.round(Number(body.delta) || 1)));

  // Guard against reacting to a clip that no longer exists (clips expire daily).
  const exists = await db.clip.findUnique({ where: { id: clipId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Clip not found." }, { status: 404 });

  // Rate-limit identity: client id (if sent) + source IP.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0";
  const viewerKey = `${clipId}:${body.reactorKey ?? "anon"}:${ip}`;
  const accepted = allowance(viewerKey, want);

  if (accepted > 0) {
    await db.clipReaction.upsert({
      where: { clipId_kind: { clipId, kind } },
      update: { count: { increment: accepted } },
      create: { clipId, kind, count: accepted },
    });
  }

  return NextResponse.json({ counts: await counts(clipId), accepted });
}
