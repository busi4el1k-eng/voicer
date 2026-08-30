import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import db from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only feed of finished dubs to browse/download for social posting, so the
// owner never has to open the R2/Spaces console. Source is the Clip table (one
// row per completed render of a PUBLIC library video) — it already carries the
// title (via the upload relation), performer, mode, date and the raw performance
// features, which is exactly what you'd sift through to pick "top clips of today".

// Rough 0..100 "energy" heuristic to rank how postable a clip is: mostly voice
// coverage (not silent) + loudness, with a lighter nod to dynamics/punch. It is
// a sorting aid, not a verdict — eyeball the previews before posting.
function energyScore(c: {
  loudness: number;
  lra: number;
  crest: number;
  silence: number;
}): number {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const coverage = clamp01(1 - c.silence); // 1 = fully voiced, 0 = all silence
  const loud = clamp01((c.loudness + 40) / 30); // ~-40 LUFS → 0, ~-10 LUFS → 1
  const dyn = clamp01(c.lra / 15); // 0..15 LU expressiveness
  const punch = clamp01((c.crest - 1) / 7); // 1..8 crest factor
  const raw = 0.45 * coverage + 0.3 * loud + 0.2 * dyn + 0.05 * punch;
  return Math.round(raw * 100);
}

function safeName(title: string, id: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "dub";
  return `${base}-${id}.mp4`;
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const range = params.get("range") ?? "today"; // today | week | all
  const sort = params.get("sort") ?? "new"; // new | score

  let gte: Date | undefined;
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    gte = d;
  } else if (range === "week") {
    gte = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  const clips = await db.clip.findMany({
    // Only dubs of PUBLIC library videos — never private uploads.
    where: {
      upload: { visibility: "public" },
      ...(gte ? { createdAt: { gte } } : {}),
    },
    include: { upload: { select: { title: true, durationMs: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const dubs = clips.map((c) => {
    const score = energyScore(c);
    const title = c.upload?.title || "Untitled";
    const name = safeName(title, c.id);
    return {
      id: c.id,
      videoUrl: c.videoUrl,
      downloadUrl: `/api/download?url=${encodeURIComponent(c.videoUrl)}&name=${encodeURIComponent(name)}`,
      title,
      author: c.author || "Guest",
      mode: c.mode,
      createdAt: c.createdAt.toISOString(),
      durationMs: c.upload?.durationMs ?? 0,
      score,
      metrics: {
        loudness: c.loudness,
        lra: c.lra,
        crest: c.crest,
        silence: c.silence,
        voicedMs: c.voicedMs,
      },
    };
  });

  if (sort === "score") dubs.sort((a, b) => b.score - a.score);

  return NextResponse.json({ dubs });
}
