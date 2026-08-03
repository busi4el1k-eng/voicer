import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

// Video ratings: after dubbing a video (solo run or party), a player scores the
// video itself 0–5 stars. One row per rater per video (raterKey), upserted so a
// re-rate just updates. Averaged per video for the library's "rank".

// GET /api/video/rate?uploadId=...&raterKey=... → this rater's score (or null).
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const uploadId = params.get("uploadId") ?? "";
  const raterKey = params.get("raterKey") ?? "";
  if (!uploadId || !raterKey) {
    return NextResponse.json({ error: "Missing video or rater." }, { status: 400 });
  }
  const row = await db.videoRating.findUnique({
    where: { uploadId_raterKey: { uploadId, raterKey } },
    select: { stars: true },
  });
  return NextResponse.json({ stars: row?.stars ?? null });
}

// POST /api/video/rate  { uploadId, raterKey, stars }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    uploadId?: string;
    raterKey?: string;
    stars?: unknown;
  };
  const uploadId = body.uploadId ?? "";
  const raterKey = body.raterKey ?? "";
  if (!uploadId || !raterKey) {
    return NextResponse.json({ error: "Missing video or rater." }, { status: 400 });
  }
  const n = Number(body.stars);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "Invalid rating." }, { status: 400 });
  }
  const stars = Math.max(0, Math.min(5, Math.round(n)));

  // Guard against rating a video that doesn't exist (keeps the table clean).
  const exists = await db.videoUpload.findUnique({ where: { id: uploadId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Video not found." }, { status: 404 });

  await db.videoRating.upsert({
    where: { uploadId_raterKey: { uploadId, raterKey } },
    update: { stars },
    create: { uploadId, raterKey, stars },
  });
  return NextResponse.json({ ok: true, stars });
}
