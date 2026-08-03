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
// A bed job "processing" for longer than this is assumed dead (the worker was
// killed mid-separation, e.g. a deploy/restart) and may be reclaimed. Comfortably
// longer than the slowest realistic separation so we never steal a live job.
const STALE_PROCESSING_MS = 30 * 60_000; // 30 minutes
// How long to wait before the background sweep re-attempts an errored bed, so a
// genuinely broken video can't loop every tick or block newer uploads.
const RETRY_ERROR_MS = 20 * 60_000; // 20 minutes

export async function generateBedForUpload(uploadId: string): Promise<void> {
  if (!demucsConfigured() || !spacesConfigured()) return;

  // Atomically claim the job. Proceed if it hasn't started ("none"/"error"), or
  // if a previous "processing" claim has gone stale — its worker died without
  // finishing, leaving the status stuck. `bedStartedAt` gates the reclaim so two
  // callers can't both grab the same job.
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claim = await db.videoUpload.updateMany({
    where: {
      id: uploadId,
      OR: [
        { bedStatus: { in: ["none", "error"] } },
        { bedStatus: "processing", bedStartedAt: { lt: staleBefore } },
        { bedStatus: "processing", bedStartedAt: null },
      ],
    },
    data: { bedStatus: "processing", bedStartedAt: new Date() },
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

// Find the next upload that still needs a bed and generate it. Processes ONE
// per call (Demucs handles a single job at a time anyway) and relies on
// generateBedForUpload's atomic claim, so it's safe to call on a loop. Returns
// true if it worked on something, so the caller can poll again promptly instead
// of waiting a full interval when there's a backlog.
export async function sweepPendingBeds(): Promise<boolean> {
  if (!demucsConfigured() || !spacesConfigured()) return false;

  const now = Date.now();
  const staleBefore = new Date(now - STALE_PROCESSING_MS);
  // Fresh work first (never-tried or a dead "processing" claim), so a broken
  // video stuck on "error" can never block newer uploads' beds.
  let pending = await db.videoUpload.findFirst({
    where: {
      sourceKey: { not: "" },
      OR: [
        { bedStatus: "none" },
        { bedStatus: "processing", bedStartedAt: { lt: staleBefore } },
        { bedStatus: "processing", bedStartedAt: null },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  // Only then retry an errored bed, and only after a backoff (transient network
  // blips recover; a genuinely broken one is retried at most every RETRY_ERROR_MS).
  if (!pending) {
    pending = await db.videoUpload.findFirst({
      where: {
        sourceKey: { not: "" },
        bedStatus: "error",
        OR: [{ bedStartedAt: { lt: new Date(now - RETRY_ERROR_MS) } }, { bedStartedAt: null }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  }
  if (!pending) return false;

  await generateBedForUpload(pending.id);
  return true;
}

// Return the bed object key for an upload, generating it inline (and awaiting)
// if it isn't ready yet. This makes a render self-healing: even if the
// background `after()` job never ran (misconfigured env, missing platform
// support for `after`, a restart mid-job), the render still removes the
// original dialogue instead of silently falling back to the untouched audio.
//
// Returns null only when a bed genuinely can't be produced (Demucs/Storage not
// configured, or separation failed) — callers then fall back to original audio.
export async function ensureBedForUpload(uploadId: string): Promise<string | null> {
  const ready = await db.videoUpload.findUnique({
    where: { id: uploadId },
    select: { bedStatus: true, bedKey: true },
  });
  if (ready?.bedStatus === "ready" && ready.bedKey) return ready.bedKey;
  if (!demucsConfigured() || !spacesConfigured()) return null;

  // Try to generate it now. generateBedForUpload no-ops if another worker holds
  // a live claim, so afterwards we poll the row for a short while in case that
  // other worker is the one finishing it.
  await generateBedForUpload(uploadId);
  for (let i = 0; i < 40; i++) {
    const u = await db.videoUpload.findUnique({
      where: { id: uploadId },
      select: { bedStatus: true, bedKey: true },
    });
    if (u?.bedStatus === "ready" && u.bedKey) return u.bedKey;
    if (u?.bedStatus === "error") return null;
    if (u?.bedStatus !== "processing") break; // "none" again → nothing is working on it
    await new Promise((r) => setTimeout(r, 3000)); // wait on a concurrent worker
  }
  return null;
}
