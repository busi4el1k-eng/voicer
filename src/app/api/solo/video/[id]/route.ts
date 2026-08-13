import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

// Public: load a shared video and its sectors for the solo run. Anyone with the
// link/code can open it (that's the point of the share code), so there's no
// ownership check here.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const upload = await db.videoUpload.findUnique({
    where: { id },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (!upload) return NextResponse.json({ error: "Video not found." }, { status: 404 });

  // Record this as a solo "run" of the video — fire-and-forget so it never
  // delays or breaks loading the video. Powers the library's "most played
  // today" window.
  void db.videoPlay.create({ data: { uploadId: upload.id, mode: "solo" } }).catch(() => {});

  return NextResponse.json({
    video: {
      id: upload.id,
      title: upload.title,
      shareId: upload.shareId,
      sourceUrl: upload.sourceUrl,
      durationMs: upload.durationMs,
      segments: upload.segments.map((s) => ({
        id: s.id,
        startMs: s.startMs,
        endMs: s.endMs,
        label: s.label,
        transcript: s.transcript,
        emotionTag: s.emotionTag,
        player: s.player ?? 1, // which seat (1-4) dubs this sector — for party mode
      })),
    },
  });
}
