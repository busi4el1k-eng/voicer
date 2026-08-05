import { join } from "node:path";
import db from "@/lib/db";
import { getObjectBuffer } from "@/lib/spaces";
import { withSourceFile, extractAudio } from "@/lib/ffmpeg";
import { asrConfigured, transcribeSentences } from "@/lib/asr";
import { makeSectors } from "@/lib/sector-llm";

// Background auto-sectoring: extract a video's audio, transcribe it into
// timestamped sentences (AssemblyAI), and let Claude turn those into sectors
// (who speaks + grouping). Replaces the upload's segments with the result.
//
// Runs OFF the request path via `after()`; the claim lives in the route so this
// runner only ever does real work.

// A job "processing" longer than this is assumed dead (worker killed mid-run)
// and may be reclaimed by a later trigger.
export const AUTO_STALE_MS = 15 * 60_000;

export async function runSectorJob(uploadId: string, speakersExpected?: number): Promise<void> {
  try {
    const upload = await db.videoUpload.findUnique({ where: { id: uploadId } });
    if (!upload?.sourceKey) throw new Error("This upload has no source audio.");
    if (!asrConfigured()) throw new Error("Auto-detect isn't configured.");

    const src = await getObjectBuffer(upload.sourceKey);
    const ext = upload.sourceKey.split(".").pop() || "mp4";

    const sentences = await withSourceFile(src, ext, async ({ dir, input }) => {
      const wav = await extractAudio(input, join(dir, "scene.wav"));
      return transcribeSentences(wav);
    });

    const sectors = await makeSectors(sentences, speakersExpected);

    // Replace the upload's segments wholesale (same contract as the segments
    // PUT): wipe, recreate in order, mark a previously-cut video as edited.
    await db.videoSegment.deleteMany({ where: { uploadId } });
    if (sectors.length > 0) {
      await db.videoSegment.createMany({
        data: sectors.map((s, i) => ({ uploadId, index: i, ...s, status: "pending" as const })),
      });
    }
    await db.videoUpload.update({
      where: { id: uploadId },
      data: {
        autoStatus: "ready",
        autoError: "",
        status: upload.status === "done" ? "edited" : upload.status,
      },
    });
  } catch (e) {
    console.error("[autosector] job failed:", e);
    await db.videoUpload
      .update({
        where: { id: uploadId },
        data: { autoStatus: "error", autoError: e instanceof Error ? e.message : "Auto-detect failed." },
      })
      .catch(() => {});
  }
}
