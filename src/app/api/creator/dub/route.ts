import { NextResponse, type NextRequest } from "next/server";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import db from "@/lib/db";
import { SPACES_PREFIX, getObjectBuffer, putObject, spacesConfigured } from "@/lib/spaces";
import { muxDub, withSourceFile, type DubTake } from "@/lib/ffmpeg";
import { ClientError, toClientMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

// Export a finished solo dub: mux the recorded takes into the full-length source
// video, replacing the original audio inside each dubbed sector. The client
// sends one audio file per sector, named `take:<segmentId>`.
export async function POST(req: NextRequest) {
  if (!spacesConfigured()) {
    return NextResponse.json({ error: "Storage isn't configured." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a form upload." }, { status: 400 });
  }

  const uploadId = String(form.get("uploadId") ?? "");
  if (!uploadId) return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });

  const upload = await db.videoUpload.findUnique({
    where: { id: uploadId },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  const src = await getObjectBuffer(upload.sourceKey);
  const ext = upload.sourceKey.split(".").pop() || "mp4";

  try {
    const outBuf = await withSourceFile(src, ext, async ({ dir, input }) => {
      // Match each uploaded take to its sector (by id), in chronological order.
      const takes: DubTake[] = [];
      let i = 0;
      for (const seg of upload.segments) {
        const file = form.get(`take:${seg.id}`);
        if (!(file instanceof File) || file.size === 0) continue;
        const path = join(dir, `take-${i}.webm`);
        await writeFile(path, Buffer.from(await file.arrayBuffer()));
        takes.push({ path, startMs: seg.startMs, endMs: seg.endMs });
        i++;
      }
      if (takes.length === 0) throw new ClientError("No recorded takes were sent.");

      const out = join(dir, "dub.mp4");
      return muxDub(input, takes, out);
    });

    const key = `${SPACES_PREFIX}sources/${upload.id}/dubs/${Date.now()}.mp4`;
    const { url } = await putObject(key, outBuf, "video/mp4");
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: toClientMessage(e, "Export failed. Please try again.") },
      { status: 500 },
    );
  }
}
