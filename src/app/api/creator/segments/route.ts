import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

// Save the editor's sectors. The editor sends the full list after the user has
// dragged / added / deleted; we replace the upload's segments wholesale, in
// chronological order. This clears any previously-cut clips for changed segments.
type Incoming = {
  startMs: number;
  endMs: number;
  label?: string;
  transcript?: string;
  emotionTag?: string;
  player?: number; // which player (1-4) dubs this sector
};

export async function PUT(req: NextRequest) {
  const { uploadId, segments, durationMs } = (await req.json().catch(() => ({}))) as {
    uploadId?: string;
    segments?: Incoming[];
    durationMs?: number;
  };
  if (!uploadId || !Array.isArray(segments)) {
    return NextResponse.json({ error: "uploadId and segments required." }, { status: 400 });
  }

  const upload = await db.videoUpload.findUnique({ where: { id: uploadId } });
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  const clean = segments
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .map((s) => ({
      startMs: Math.max(0, Math.round(s.startMs)),
      endMs: Math.round(s.endMs),
      label: String(s.label ?? "").slice(0, 80),
      transcript: String(s.transcript ?? "").slice(0, 400),
      emotionTag: String(s.emotionTag ?? "").slice(0, 24),
      // Clamp to a valid player seat (1-4); default to player 1.
      player: Math.min(4, Math.max(1, Math.round(Number(s.player) || 1))),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  await db.videoSegment.deleteMany({ where: { uploadId } });
  if (clean.length > 0) {
    await db.videoSegment.createMany({
      data: clean.map((s, i) => ({ uploadId, index: i, ...s, status: "pending" as const })),
    });
  }

  const saved = await db.videoUpload.update({
    where: { id: uploadId },
    data: {
      // sectors changed after a cut → mark as edited (needs re-cutting)
      status: upload.status === "done" ? "edited" : upload.status,
      ...(Number.isFinite(durationMs) ? { durationMs: Math.round(durationMs!) } : {}),
    },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  return NextResponse.json({ upload: saved });
}
