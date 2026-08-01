import { join } from "node:path";
import db from "@/lib/db";
import { getObjectBuffer, putObject, SPACES_PREFIX, spacesConfigured } from "@/lib/spaces";
import { withSourceFile, extractAudio } from "@/lib/ffmpeg";
import { demucsConfigured, separateBed } from "@/lib/demucs";

// Generate (once) the Demucs music bed for a source video: extract its audio,
// separate out the vocals, and cache the "no_vocals" stem so every future
// render can keep the original music under the dubbed sectors.
//
// Slow (CPU separation, minutes) — always call this OFF the request path, e.g.
// via `after()`. Safe to call repeatedly: an atomic claim prevents double work.
export async function generateBedForUpload(uploadId: string): Promise<void> {
  if (!demucsConfigured() || !spacesConfigured()) return;

  // Atomically claim the job: only proceed if it isn't already ready/processing.
  const claim = await db.videoUpload.updateMany({
    where: { id: uploadId, bedStatus: { in: ["none", "error"] } },
    data: { bedStatus: "processing" },
  });
  if (claim.count === 0) return;

  const upload = await db.videoUpload.findUnique({ where: { id: uploadId } });
  if (!upload?.sourceKey) {
    await db.videoUpload
      .update({ where: { id: uploadId }, data: { bedStatus: "error" } })
      .catch(() => {});
    return;
  }

  try {
    const src = await getObjectBuffer(upload.sourceKey);
    const ext = upload.sourceKey.split(".").pop() || "mp4";
    const bed = await withSourceFile(src, ext, async ({ dir, input }) => {
      const wav = await extractAudio(input, join(dir, "scene.wav"));
      return separateBed(wav, "scene.wav");
    });

    const key = `${SPACES_PREFIX}sources/${uploadId}/bed.wav`;
    await putObject(key, bed, "audio/wav");
    await db.videoUpload.update({
      where: { id: uploadId },
      data: { bedKey: key, bedStatus: "ready" },
    });
  } catch (e) {
    console.error("[bed] generation failed for", uploadId, e);
    await db.videoUpload
      .update({ where: { id: uploadId }, data: { bedStatus: "error" } })
      .catch(() => {});
  }
}
