import { NextResponse } from "next/server";
import { listCreators } from "@/lib/creators-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: the featured creators shown in the Video library's "Creators" tab.
// Seeds the table from the config the first time it's empty (see creators-db).
export async function GET() {
  const creators = await listCreators();
  return NextResponse.json({ creators });
}
