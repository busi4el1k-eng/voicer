import "server-only";
import db from "@/lib/db";
import { analyzeVoice, type DubTake } from "@/lib/ffmpeg";

// ── Performance scoring for the "Clips of Today" podium ─────────────────────
// Pure DSP, no AI. We measure each finished dub's RECORDED VOICE (never the
// final mix, so the music bed can't skew it), store the raw features, and rank
// them relative to the day's other clips at read time.

// One performance's features, aggregated across all its sectors.
export type AggFeatures = {
  loudness: number; // duration-weighted integrated loudness (LUFS)
  lra: number; // duration-weighted loudness range (LU) — expressiveness
  crest: number; // duration-weighted crest factor — punch
  silence: number; // silence ratio 0..1 across the whole performance
  voicedMs: number; // total dubbed duration
};

// Analyse every recorded take (files still on disk during the render) and fold
// them into one duration-weighted feature set. Best-effort: a take that fails to
// decode is skipped rather than aborting the whole score.
export async function analyzeTakes(takes: DubTake[]): Promise<AggFeatures | null> {
  let wSum = 0;
  let loud = 0;
  let lra = 0;
  let crest = 0;
  let silenceMs = 0;
  let voicedMs = 0;

  for (const t of takes) {
    const durMs = Math.max(0, t.endMs - t.startMs);
    const w = Math.max(durMs, 1); // weight short sectors a little so w>0
    let f;
    try {
      f = await analyzeVoice(t.path);
    } catch {
      continue;
    }
    wSum += w;
    loud += f.loudness * w;
    lra += f.lra * w;
    crest += f.crest * w;
    silenceMs += f.silenceSec * 1000;
    voicedMs += durMs;
  }
  if (wSum === 0) return null;

  return {
    loudness: loud / wSum,
    lra: lra / wSum,
    crest: crest / wSum,
    silence: voicedMs > 0 ? Math.min(1, silenceMs / voicedMs) : 0,
    voicedMs,
  };
}

// Record a clip row for a finished dub — ONLY when the source video is public
// (the podium pool is public videos only). Call fire-and-forget from the render
// routes: it must never block or fail the render.
export async function recordPublicClip(opts: {
  uploadId: string;
  visibility: string;
  videoUrl: string;
  mode: "solo" | "party";
  author: string;
  features: AggFeatures | null;
}): Promise<void> {
  if (opts.visibility !== "public" || !opts.features) return;
  const f = opts.features;
  await db.clip.create({
    data: {
      uploadId: opts.uploadId,
      videoUrl: opts.videoUrl,
      mode: opts.mode,
      author: opts.author.slice(0, 120),
      loudness: f.loudness,
      lra: f.lra,
      crest: f.crest,
      silence: f.silence,
      voicedMs: f.voicedMs,
    },
  });
  // Opportunistic cleanup: sweep anything past 24h on each new clip.
  void purgeExpiredClips().catch(() => {});
}

export type PodiumClip = {
  id: string;
  videoUrl: string;
  mode: string;
  author: string;
  score: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A clip is a fleeting thing: nothing lives in the DB past 24h. We enforce this
// opportunistically — every read (dashboard load) and write (finished dub) also
// deletes any clip older than a day. Under normal traffic that means a row never
// meaningfully outlives its 24h window, with no cron/scheduler to maintain. This
// only removes the podium POINTER row; the rendered MP4's own lifetime is handled
// by storage lifecycle (and it may be shared elsewhere), so we don't touch it.
export async function purgeExpiredClips(): Promise<void> {
  const cutoff = new Date(Date.now() - DAY_MS);
  await db.clip.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

// Top clips of the last 24h, ranked by a composite performance score. Each raw
// feature is min-max normalised across the day's field (so "loudest / most
// dynamic" is relative, not an absolute threshold), then blended:
//   expressiveness (dynamics + punch)  50%
//   coverage (did they perform, not mumble)  25%
//   energy (loudness, bounded)  25%
export async function getTopClipsToday(limit = 3): Promise<PodiumClip[]> {
  // Sweep expired clips on every dashboard read so the DB never holds a clip
  // longer than a day, then only ever consider the last 24h.
  void purgeExpiredClips().catch(() => {});

  const since = new Date(Date.now() - DAY_MS);
  const rows = await db.clip.findMany({
    where: { createdAt: { gte: since }, upload: { visibility: "public" } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (rows.length === 0) return [];

  // Min-max normaliser over today's values; degenerate field → neutral 0.5.
  const norm = (vals: number[]) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return (v: number) => (max > min ? (v - min) / (max - min) : 0.5);
  };
  const nLra = norm(rows.map((r) => r.lra));
  const nCrest = norm(rows.map((r) => r.crest));
  const nLoud = norm(rows.map((r) => r.loudness));

  const scored = rows.map((r) => {
    const expr = 0.6 * nLra(r.lra) + 0.4 * nCrest(r.crest);
    const coverage = 1 - r.silence;
    const energy = nLoud(r.loudness);
    const score = Math.round(100 * (0.5 * expr + 0.25 * coverage + 0.25 * energy));
    return { id: r.id, videoUrl: r.videoUrl, mode: r.mode, author: r.author, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
