import { NextResponse, after, type NextRequest } from "next/server";
import db from "@/lib/db";
import { asrConfigured } from "@/lib/asr";
import { runSectorJob, AUTO_STALE_MS } from "@/lib/sectors.server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Auto-detect dub sectors from a video's audio. The heavy work (vocal isolation
// + transcription + diarization) is slow, so this kicks it off in the background
// and returns immediately; the editor polls GET for completion. Mirrors the
// music-bed pipeline (bed route + bed.server).

// GET — poll the auto-sector job's status. Returns the detected segments once
// it's ready so the editor can load them directly.
export async function GET(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get("uploadId") || "";
  if (!uploadId) return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });

  const u = await db.videoUpload.findUnique({
    where: { id: uploadId },
    select: {
      autoStatus: true,
      autoError: true,
      segments: { orderBy: { index: "asc" } },
    },
  });
  if (!u) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  return NextResponse.json({
    status: u.autoStatus,
    error: u.autoError,
    // Only meaningful once ready, but cheap to always include.
    segments: u.segments,
  });
}

// POST — start (or restart) the auto-sector job. Atomically claims the job so a
// double-click or a dead previous run can't run it twice, then schedules the
// heavy work after the response.
export async function POST(req: NextRequest) {
  if (!asrConfigured()) {
    return NextResponse.json({ error: "Auto-detect isn't configured." }, { status: 503 });
  }

  const { uploadId, speakersExpected } = (await req.json().catch(() => ({}))) as {
    uploadId?: string;
    speakersExpected?: number;
  };
  if (!uploadId) return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });

  const upload = await db.videoUpload.findUnique({ where: { id: uploadId }, select: { id: true } });
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  // Atomic claim: start only if idle/finished/errored, or a previous
  // "processing" job has gone stale (its worker died). `autoStartedAt` gates the
  // reclaim so two callers can't both grab the same job.
  const staleBefore = new Date(Date.now() - AUTO_STALE_MS);
  const claim = await db.videoUpload.updateMany({
    where: {
      id: uploadId,
      OR: [
        { autoStatus: { in: ["idle", "ready", "error"] } },
        { autoStatus: "processing", autoStartedAt: { lt: staleBefore } },
        { autoStatus: "processing", autoStartedAt: null },
      ],
    },
    data: { autoStatus: "processing", autoStartedAt: new Date(), autoError: "" },
  });

  // Someone else is already running it — just report processing; the editor
  // keeps polling GET either way.
  if (claim.count === 0) return NextResponse.json({ status: "processing" });

  after(() => runSectorJob(uploadId, speakersExpected));
  return NextResponse.json({ status: "processing" });
}
