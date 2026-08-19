import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight client probe so the UI can reveal the "Manage creators" link only
// to admins. Never leaks anything beyond a boolean.
export async function GET() {
  return NextResponse.json({ admin: await isAdmin() });
}
