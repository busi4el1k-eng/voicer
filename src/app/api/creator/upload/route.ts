import { NextResponse, after, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { SPACES_PREFIX, deleteObjects, putObjectStream, spacesConfigured } from "@/lib/spaces";
import { rateLimit } from "@/lib/rate-limit";
import { generateShareId } from "@/lib/share-id.server";
import { generateBedForUpload } from "@/lib/bed.server";
import { assertReadable, isPermanentInputError } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 300;

// Step 1 of the creator pipeline: upload a source video to Spaces and record it.
//
// The video is sent as the raw request body (not multipart form-data) with its
// title/filename in the query string, so we can pipe it straight to Spaces in a
// stream. That keeps memory use flat (a few MB of in-flight parts) instead of
// loading the whole file — up to 1 GB — into RAM, which is what let concurrent
// large uploads exhaust the host.
export async function POST(req: NextRequest) {
  if (!spacesConfigured()) {
    return NextResponse.json({ error: "Storage isn't configured." }, { status: 500 });
  }
  // Creating videos is a members-only feature. Guests — including a signed-in
  // player who chose "Play as guest" — can only play, so getOrCreateUser()
  // returning null (see guest-mode.ts) is rejected here as well as in the UI.
  const user = await getOrCreateUser();
  if (!user) {
    return NextResponse.json(
      { error: "Video creating is for members only. Sign in to create your own." },
      { status: 403 },
    );
  }

  const gate = rateLimit(`upload:${user.id}`, { maxRequests: 10, windowMs: 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });

  // File metadata rides in the query string; the body is the raw video bytes.
  const params = req.nextUrl.searchParams;
  const filename = (params.get("filename") || "").slice(0, 200);
  const title = (params.get("title") || "").slice(0, 120);
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.startsWith("video/")) {
    return NextResponse.json({ error: "Please upload a video file." }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "No file." }, { status: 400 });
  }

  const ext = (filename.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";

  // Create the row first so its id keys the storage path. Each video gets a
  // short shareable code so it can be opened later (e.g. in a solo run).
  const shareId = await generateShareId();
  const upload = await db.videoUpload.create({
    data: {
      userId: user.id,
      title: title || filename || "Untitled",
      sourceKey: "",
      sourceUrl: "",
      shareId,
    },
  });
  const key = `${SPACES_PREFIX}sources/${upload.id}/source.${ext}`;

  let url: string;
  try {
    // Pipe the request body straight to Spaces — never buffered whole in RAM.
    const nodeStream = Readable.fromWeb(req.body as NodeReadableStream<Uint8Array>);
    ({ url } = await putObjectStream(key, nodeStream, contentType));
  } catch {
    // Storage failed — drop the orphan row so it doesn't show as a broken video.
    await db.videoUpload.delete({ where: { id: upload.id } }).catch(() => {});
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }

  // Validate the stored file before it enters the pipeline: a truncated or
  // corrupt upload (e.g. a recording cut off before its moov atom was written)
  // would otherwise fail every render and loop the bed worker forever. We probe
  // the Spaces URL directly (header-only, cheap even for a big file). Only a
  // definitive "bad data" verdict rejects — if the probe itself can't run
  // (network/env), we let the upload through and let the bed worker classify it.
  try {
    await assertReadable(url);
  } catch (e) {
    if (isPermanentInputError(e)) {
      await deleteObjects([key]).catch(() => {});
      await db.videoUpload.delete({ where: { id: upload.id } }).catch(() => {});
      return NextResponse.json(
        { error: "That video looks incomplete or corrupted. Please re-export it and upload again." },
        { status: 400 },
      );
    }
    console.error("[upload] validity probe skipped for", upload.id, e);
  }

  const saved = await db.videoUpload.update({
    where: { id: upload.id },
    data: { sourceKey: key, sourceUrl: url },
  });

  // Start separating the music bed now, off the request path, so it's likely
  // ready by the time the creator finishes placing sectors and renders. No-op
  // when Demucs isn't configured; safe to re-trigger via /api/creator/bed.
  after(() => generateBedForUpload(saved.id));

  return NextResponse.json({ upload: saved });
}
