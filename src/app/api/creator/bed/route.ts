import { NextResponse, after, type NextRequest } from "next/server";
import db from "@/lib/db";
import { demucsConfigured } from "@/lib/demucs";
import { generateBedForUpload } from "@/lib/bed.server";
import { publicUrl } from "@/lib/spaces";

export const runtime = "nodejs";
export const maxDuration = 300;

// Status of a source's music bed: none | processing | ready | error.
export async function GET(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get("uploadId") || "";
  if (!uploadId) return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });
  const u = await db.videoUpload.findUnique({
    where: { id: uploadId },
    select: { bedStatus: true, bedKey: true },
  });
  if (!u) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  return NextResponse.json({
    status: u.bedStatus,
    url: u.bedKey ? publicUrl(u.bedKey) : null,
  });
}

// Kick off bed separation (once). Returns immediately; the heavy Demucs work
// runs after the response via `after()`. Poll GET for completion.
export async function POST(req: NextRequest) {
  if (!demucsConfigured()) {
    return NextResponse.json({ error: "Separation isn't configured." }, { status: 503 });
  }
  const { uploadId } = (await req.json().catch(() => ({}))) as { uploadId?: string };
  if (!uploadId) return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });

  const u = await db.videoUpload.findUnique({
    where: { id: uploadId },
    select: { bedStatus: true },
  });
  if (!u) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  if (u.bedStatus === "none" || u.bedStatus === "error") {
    after(() => generateBedForUpload(uploadId));
    return NextResponse.json({ status: "processing" });
  }
  return NextResponse.json({ status: u.bedStatus });
}
