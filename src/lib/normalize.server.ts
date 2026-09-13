import { join } from "node:path";
import db from "@/lib/db";
import { getObjectBuffer, putObject, spacesConfigured } from "@/lib/spaces";
import { withSourceFile, remuxFaststart, isPermanentInputError } from "@/lib/ffmpeg";

// De-fragment + faststart every source video once, so iOS/Safari can seek into a
// single sector by byte-range instead of downloading the whole file to reach it.
//
// Background: many exporters (and yt-dlp-style muxes) emit *fragmented* MP4s —
// a `moov` with an `mvex` box and the samples spread across `moof` fragments,
// with no central seek index (`sidx`/`mfra`). Chromium (desktop/Android) tolerates
// a bare fragmented MP4 in a <video> and does ranged reads to seek; Safari does
// not — it downloads sequentially from the start to reach the requested time, so
// a player asked to record a sector at 2:30 waits for the whole video. Remuxing
// with `-c copy -movflags +faststart` rewrites the file as a normal progressive
// MP4 (single moov at the front, no fragments) which every browser can seek.
//
// Runs OFF the request path (via `after()` on upload and an in-process sweep, the
// same shape as the Demucs bed worker) so it never blocks a response and handles
// any file size. Safe to call repeatedly: an atomic claim prevents double work,
// and an already-clean source is detected and left untouched.

// A "processing" claim older than this is assumed dead (worker killed mid-remux,
// e.g. a deploy) and may be reclaimed. Comfortably longer than the slowest remux.
const STALE_PROCESSING_MS = 15 * 60_000;
// Wait this long before re-attempting a source that errored, so a genuinely
// broken one can't loop every sweep or block newer uploads.
const RETRY_ERROR_MS = 20 * 60_000;

// Only MP4-family containers have the fragmented-vs-progressive distinction that
// breaks iOS seeking. Leave webm/others untouched (marked "ready", never remuxed).
const MP4_CONTENT_TYPE: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
};

// Walk the top-level MP4 box tree to decide whether a source needs remuxing:
// TRUE if it's fragmented (any `moof` box) or not faststart (no `moov`, or `moov`
// after `mdat`). Reads 32-bit big-endian box sizes (with 64-bit largesize and
// size-0-to-EOF handling) and only jumps between top-level boxes, so it's a
// handful of iterations even on a large file. On any parse oddity it returns TRUE
// (remux is idempotent and safe, so "when unsure, normalize").
function needsRemux(buf: Buffer): boolean {
  const n = buf.length;
  let off = 0;
  let moovAt = -1;
  let mdatAt = -1;
  while (off + 8 <= n) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > n) return true; // truncated largesize header
      // 64-bit largesize (two 32-bit halves; avoids BigInt).
      size = buf.readUInt32BE(off + 8) * 2 ** 32 + buf.readUInt32BE(off + 12);
      header = 16;
    } else if (size === 0) {
      size = n - off; // final box, extends to EOF
    }
    if (size < header) return true; // malformed → normalize to be safe
    if (type === "moof") return true; // fragmented
    if (type === "moov" && moovAt === -1) moovAt = off;
    else if (type === "mdat" && mdatAt === -1) mdatAt = off;
    off += size;
  }
  if (moovAt === -1) return true; // no moov seen → not a clean faststart file
  if (mdatAt !== -1 && moovAt > mdatAt) return true; // moov after mdat → not faststart
  return false;
}

// Normalize one upload's source in place (overwrites the same Spaces key, so its
// public sourceUrl never changes). No-ops when Storage isn't configured.
export async function normalizeSourceForUpload(uploadId: string): Promise<void> {
  if (!spacesConfigured()) return;

  // Atomically claim the job: proceed if it hasn't run ("pending"/"error") or a
  // previous "processing" claim has gone stale. `sourceFsStartedAt` gates the
  // reclaim so two workers can't both grab the same job.
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claim = await db.videoUpload.updateMany({
    where: {
      id: uploadId,
      OR: [
        { sourceFsStatus: { in: ["pending", "error"] } },
        { sourceFsStatus: "processing", sourceFsStartedAt: { lt: staleBefore } },
        { sourceFsStatus: "processing", sourceFsStartedAt: null },
      ],
    },
    data: { sourceFsStatus: "processing", sourceFsStartedAt: new Date() },
  });
  if (claim.count === 0) return;

  const upload = await db.videoUpload.findUnique({
    where: { id: uploadId },
    select: { id: true, sourceKey: true },
  });
  if (!upload?.sourceKey) {
    await setStatus(uploadId, "error");
    return;
  }

  const ext = (upload.sourceKey.split(".").pop() || "").toLowerCase();
  const contentType = MP4_CONTENT_TYPE[ext];
  if (!contentType) {
    // Non-MP4 container: no fragmented-seek problem to fix. Mark done so the
    // sweep never revisits it.
    await setStatus(uploadId, "ready");
    return;
  }

  try {
    const src = await getObjectBuffer(upload.sourceKey);
    if (!needsRemux(src)) {
      // Already a clean progressive faststart MP4 — leave the bytes untouched.
      await setStatus(uploadId, "ready");
      return;
    }
    const fixed = await withSourceFile(src, ext, ({ dir, input }) =>
      remuxFaststart(input, join(dir, `faststart.${ext}`)),
    );
    // Overwrite the same key (public-read by default) so sourceUrl is unchanged.
    await putObject(upload.sourceKey, fixed, contentType);
    await setStatus(uploadId, "ready");
  } catch (e) {
    // A corrupt/truncated source will never remux — mark it terminally "invalid"
    // so the sweep skips it forever. Transient failures stay "error" (retried).
    const permanent = isPermanentInputError(e);
    console.error(
      `[normalize] ${permanent ? "permanently failed (invalid source)" : "failed"} for`,
      uploadId,
      e,
    );
    await setStatus(uploadId, permanent ? "invalid" : "error");
  }
}

async function setStatus(id: string, sourceFsStatus: string): Promise<void> {
  await db.videoUpload.update({ where: { id }, data: { sourceFsStatus } }).catch(() => {});
}

// Find the next source still needing normalization and process it. Handles ONE
// per call and relies on the atomic claim, so it's safe to call on a loop.
// Returns true if it worked on something, so the caller can poll again promptly
// when there's a backlog (e.g. a whole existing library to backfill after deploy).
export async function sweepUnnormalizedSources(): Promise<boolean> {
  if (!spacesConfigured()) return false;

  const now = Date.now();
  const staleBefore = new Date(now - STALE_PROCESSING_MS);
  // Newest first: fix what players are most likely dubbing right now before
  // grinding back through the archive.
  let pending = await db.videoUpload.findFirst({
    where: {
      sourceKey: { not: "" },
      OR: [
        { sourceFsStatus: "pending" },
        { sourceFsStatus: "processing", sourceFsStartedAt: { lt: staleBefore } },
        { sourceFsStatus: "processing", sourceFsStartedAt: null },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  // Only then retry an errored source, and only after a backoff.
  if (!pending) {
    pending = await db.videoUpload.findFirst({
      where: {
        sourceKey: { not: "" },
        sourceFsStatus: "error",
        OR: [{ sourceFsStartedAt: { lt: new Date(now - RETRY_ERROR_MS) } }, { sourceFsStartedAt: null }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
  }
  if (!pending) return false;

  await normalizeSourceForUpload(pending.id);
  return true;
}
