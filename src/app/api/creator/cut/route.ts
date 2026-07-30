import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { SPACES_PREFIX, getObjectBuffer, putObject, spacesConfigured } from "@/lib/spaces";
import { cutSegment, withSourceFile } from "@/lib/ffmpeg";
import { toClientMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

// Step 3: cut the source video at each detected segment with ffmpeg and upload
// each clip to Spaces. The part URLs are saved back onto the VideoSegment rows.
export async function POST(req: NextRequest) {
  if (!spacesConfigured()) {
    return NextResponse.json({ error: "Storage isn't configured." }, { status: 500 });
  }

  const { uploadId } = (await req.json().catch(() => ({}))) as { uploadId?: string };
  if (!uploadId) return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });

  const upload = await db.videoUpload.findUnique({
    where: { id: uploadId },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  if (upload.segments.length === 0) {
    return NextResponse.json({ error: "Nothing to cut — add sectors first." }, { status: 400 });
  }

  await db.videoUpload.update({ where: { id: uploadId }, data: { status: "cutting", error: "" } });

  try {
    const src = await getObjectBuffer(upload.sourceKey);
    const ext = upload.sourceKey.split(".").pop() || "mp4";

    await withSourceFile(src, ext, async ({ dir, input }) => {
      for (const seg of upload.segments) {
        try {
          const clip = await cutSegment(input, dir, seg.index, seg.startMs, seg.endMs);
          const key = `${SPACES_PREFIX}sources/${upload.id}/parts/${seg.index}.mp4`;
          const { url } = await putObject(key, clip, "video/mp4");
          await db.videoSegment.update({
            where: { id: seg.id },
            data: { partKey: key, partUrl: url, status: "cut" },
          });
        } catch (segErr) {
          // Best-effort: recording the segment's error status must not mask (or
          // replace) the original failure if the DB is momentarily unreachable.
          try {
            await db.videoSegment.update({ where: { id: seg.id }, data: { status: "error" } });
          } catch (statusErr) {
            console.error("[cut] could not mark segment error", statusErr);
          }
          throw segErr;
        }
      }
    });

    const saved = await db.videoUpload.update({
      where: { id: uploadId },
      data: { status: "done" },
      include: { segments: { orderBy: { index: "asc" } } },
    });
    return NextResponse.json({ upload: saved });
  } catch (e) {
    // Log full detail server-side; persist + return only a safe message.
    const message = toClientMessage(e, "Cutting failed. Please try again.");
    try {
      await db.videoUpload.update({
        where: { id: uploadId },
        data: { status: "error", error: message },
      });
    } catch (dbErr) {
      console.error("[cut] could not record error status", dbErr);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
