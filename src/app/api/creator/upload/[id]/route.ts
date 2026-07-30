import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { deleteObjects, spacesConfigured } from "@/lib/spaces";

export const runtime = "nodejs";

// Load an upload the current owner is allowed to touch (own uploads for a
// signed-in user, anonymous uploads for a guest) — mirrors the jobs listing.
async function ownedUpload(id: string) {
  const user = await getOrCreateUser();
  const upload = await db.videoUpload.findUnique({
    where: { id },
    include: { segments: true },
  });
  if (!upload) return { upload: null as null };
  const owns = user ? upload.userId === user.id : upload.userId === null;
  return { upload: owns ? upload : null };
}

// Rename an upload (the "change" action in the management table).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  if (typeof title !== "string") {
    return NextResponse.json({ error: "title required." }, { status: 400 });
  }
  const { upload } = await ownedUpload(id);
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  const saved = await db.videoUpload.update({
    where: { id },
    data: { title: title.slice(0, 120) },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  return NextResponse.json({ upload: saved });
}

// Delete an upload: its DB row (segments cascade) and its Spaces objects
// (source video + any cut clips).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { upload } = await ownedUpload(id);
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  if (spacesConfigured()) {
    const keys = [upload.sourceKey, ...upload.segments.map((s) => s.partKey ?? "")];
    try {
      await deleteObjects(keys);
    } catch {
      /* storage cleanup is best-effort; still drop the DB row */
    }
  }

  await db.videoUpload.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
