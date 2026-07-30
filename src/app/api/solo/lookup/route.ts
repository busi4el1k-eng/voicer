import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

// Look up a video by its share code so a solo player can load it. Codes are
// stored uppercase and dash-free, so normalise the input the same way (this lets
// people paste the pretty "ABCD-EFG" form too).
export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!code) return NextResponse.json({ error: "Enter a share code." }, { status: 400 });

  const upload = await db.videoUpload.findUnique({
    where: { shareId: code },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (!upload) {
    return NextResponse.json({ error: "No video found for that code." }, { status: 404 });
  }

  // Recommended players = how many distinct player seats (1-4) the creator
  // assigned across the sectors. Used by party mode; solo just ignores it.
  const players = new Set(upload.segments.map((s) => s.player ?? 1)).size;

  return NextResponse.json({
    video: {
      id: upload.id,
      title: upload.title,
      shareId: upload.shareId,
      status: upload.status,
      sourceUrl: upload.sourceUrl,
      durationMs: upload.durationMs,
      lines: upload.segments.length,
      players,
    },
  });
}
