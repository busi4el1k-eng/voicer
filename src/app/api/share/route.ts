import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { SPACES_PUBLIC_BASE } from "@/lib/spaces";

export const runtime = "nodejs";

// Create a public, shareable link for a finished dub. The rendered MP4 already
// lives in Spaces; we just store its URL under a short id so anyone can open
// /watch/<id> to watch it. No auth — a guest who just finished a dub can share.
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

  return NextResponse.json({ id: share.id });
}
