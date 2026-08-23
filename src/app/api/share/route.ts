import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import {
  SPACES_PREFIX,
  SPACES_PUBLIC_BASE,
  copyObject,
  keyFromPublicUrl,
  spacesConfigured,
} from "@/lib/spaces";

export const runtime = "nodejs";

// Create a public, shareable link for a finished dub. The rendered MP4 lives in
// Spaces — but party/duel renders land under the auto-expiring rooms/ prefix, so
// we COPY the file into a permanent shared/<id>.mp4 home first. That way the
// storage lifecycle can clean up throwaway renders after a day without ever
// breaking a /watch link someone chose to keep.
export async function POST(req: NextRequest) {
  const { videoUrl, title, mode } = (await req.json().catch(() => ({}))) as {
    videoUrl?: string;
    title?: string;
    mode?: string;
  };

  // Only allow sharing files that actually live in our bucket — never let this
  // become an open redirect / arbitrary-URL store.
  if (!videoUrl || !videoUrl.startsWith(`${SPACES_PUBLIC_BASE}/`)) {
    return NextResponse.json({ error: "Invalid video." }, { status: 400 });
  }

  const share = await db.sharedDub.create({
    data: {
      videoUrl,
      title: (title ?? "").slice(0, 200),
      mode: mode === "party" ? "party" : "solo",
    },
  });

  // Promote the render into a permanent copy keyed by the share id. Best-effort:
  // if the copy fails (or storage isn't configured), the link still works off the
  // original URL — it just inherits that file's lifecycle instead of outliving it.
  const srcKey = keyFromPublicUrl(videoUrl);
  if (spacesConfigured() && srcKey) {
    try {
      const { url } = await copyObject(srcKey, `${SPACES_PREFIX}shared/${share.id}.mp4`);
      await db.sharedDub.update({ where: { id: share.id }, data: { videoUrl: url } });
    } catch (e) {
      console.warn(`[share] durable copy failed for ${share.id}, keeping original url:`, e);
    }
  }

  return NextResponse.json({ id: share.id });
}
