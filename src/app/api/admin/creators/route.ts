import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { listCreators, creatorData, slugifyHandle, type CreatorInput } from "@/lib/creators-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin: full list (with every video, incl. unedited) for the management UI.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ creators: await listCreators({ admin: true }) });
}

// Admin: create a creator profile. Videos are added afterwards via upload+editor.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as CreatorInput;
  const handle = slugifyHandle(body.handle);
  if (!handle) return NextResponse.json({ error: "A handle is required." }, { status: 400 });

  const clash = await db.creator.findUnique({ where: { handle } });
  if (clash) return NextResponse.json({ error: "That handle is already taken." }, { status: 409 });

  const max = await db.creator.aggregate({ _max: { sort: true } });
  const created = await db.creator.create({
    data: { handle, ...creatorData(body), sort: (max._max.sort ?? -1) + 1 },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
