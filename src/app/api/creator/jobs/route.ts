import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { generateShareId } from "@/lib/share-id.server";
import { SHARE_ID_LENGTH } from "@/lib/share-id";

export const runtime = "nodejs";

// The creator's own uploads and their segments, newest first.
// `?scope=personal` hides creator-attached videos (creatorId set) — used by the
// personal studio list so those show only in /admin/creators. The editor calls
// this without a scope so it can still load a creator video by id.
export async function GET(req: NextRequest) {
  const user = await getOrCreateUser();
  const personalOnly = req.nextUrl.searchParams.get("scope") === "personal";
  const uploads = await db.videoUpload.findMany({
    where: {
      ...(user ? { userId: user.id } : { userId: null }),
      ...(personalOnly ? { creatorId: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { segments: { orderBy: { index: "asc" } } },
  });

  // Ensure every video has a current-format (XXXX-XXXX, 8-char) share code:
  // backfill missing ones and upgrade any older/shorter codes.
  for (const u of uploads) {
    if (!u.shareId || u.shareId.length !== SHARE_ID_LENGTH) {
      u.shareId = await generateShareId();
      await db.videoUpload.update({ where: { id: u.id }, data: { shareId: u.shareId } });
    }
  }

  return NextResponse.json({ uploads });
}
