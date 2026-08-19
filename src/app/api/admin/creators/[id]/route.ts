import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { creatorData, slugifyHandle } from "@/lib/creators-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin: update a creator's profile (videos are managed separately via upload).
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const existing = await db.creator.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Creator not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const handle = slugifyHandle(body.handle) || existing.handle;
  if (handle !== existing.handle) {
    const clash = await db.creator.findUnique({ where: { handle } });
    if (clash) return NextResponse.json({ error: "That handle is already taken." }, { status: 409 });
  }

  await db.creator.update({ where: { id }, data: { handle, ...creatorData(body) } });
  return NextResponse.json({ ok: true });
}

// Admin: delete a creator. Its videos' creatorId is set null (they stay private
// uploads, so they don't leak into the Community feed).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  await db.creator.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
