import { NextResponse } from "next/server";
import db from "@/lib/db";
import { BASE_SELECT, libraryWhere, serializeRows, ALL_LANG } from "@/lib/library-videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Safety cap: never serialize more than this many rows in one manifest. The
// library is small (a niche app), so this comfortably covers the whole thing;
// it only exists so a runaway table can't blow up the payload.
const MANIFEST_CAP = 2000;

// The whole library in one lightweight payload (all languages, newest first).
// The client caches this — keyed by the total count — and does its own
// sorting / language filtering / pagination, so browsing never re-hits the DB
// until a new video is actually added. Heavy per-page scans stop repeating.
export async function GET() {
  const rows = await db.videoUpload.findMany({
    where: libraryWhere(ALL_LANG),
    orderBy: { createdAt: "desc" },
    take: MANIFEST_CAP,
    select: { ...BASE_SELECT },
  });
  const videos = await serializeRows(rows);
  return NextResponse.json({ videos, total: videos.length });
}
