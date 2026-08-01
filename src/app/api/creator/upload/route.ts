import { NextResponse, after, type NextRequest } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { SPACES_PREFIX, putObject, spacesConfigured } from "@/lib/spaces";
import { rateLimit } from "@/lib/rate-limit";
import { generateShareId } from "@/lib/share-id.server";
import { generateBedForUpload } from "@/lib/bed.server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Step 1 of the creator pipeline: upload a source video to Spaces and record it.
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  const title = String(form.get("title") ?? "").slice(0, 120);
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (!file.type.startsWith("video/")) {
    return NextResponse.json({ error: "Please upload a video file." }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const buf = Buffer.from(await file.arrayBuffer());

  // Create the row first so its id keys the storage path. Each video gets a
  // short shareable code so it can be opened later (e.g. in a solo run).
  const shareId = await generateShareId();
  const upload = await db.videoUpload.create({
    data: {
      userId: user.id,
      title: title || file.name,
      sourceKey: "",
      sourceUrl: "",
      shareId,
    },
  });
  const key = `${SPACES_PREFIX}sources/${upload.id}/source.${ext}`;
  const { url } = await putObject(key, buf, file.type);

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
