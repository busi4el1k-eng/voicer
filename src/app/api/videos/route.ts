import { NextResponse } from "next/server";
import db from "@/lib/db";
import { generateShareId } from "@/lib/share-id.server";
import { SHARE_ID_LENGTH } from "@/lib/share-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The shared Video library: every upload a creator has marked "public",
// browsable by any user (guests included). Only videos that actually have cut
// sectors are worth listing, but we surface the line count so the UI can hint
// when a video isn't playable yet.
export async function GET() {
  const uploads = await db.videoUpload.findMany({
    where: { visibility: "public" },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: { segments: { select: { id: true, player: true } } },
  });

  // VideoUpload keeps only a raw userId (no relation), so resolve the creators'
  // display names in one batched lookup rather than N per-row queries.
  const userIds = [...new Set(uploads.map((u) => u.userId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, avatarColor: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Average star rank per video (one grouped query), for the library display.
  const ratingRows = uploads.length
    ? await db.videoRating.groupBy({
        by: ["uploadId"],
        where: { uploadId: { in: uploads.map((u) => u.id) } },
        _avg: { stars: true },
        _count: true,
      })
    : [];
  const ratingByUpload = new Map(
    ratingRows.map((r) => [r.uploadId, { avg: r._avg.stars ?? 0, count: r._count }]),
  );

  // Public videos need a share code so anyone can look them up / play them.
  // Backfill any missing or legacy-length codes on read (same as the jobs list).
  const videos = [];
  for (const u of uploads) {
    // Skip videos with fewer than one line (no cut sectors) — there's nothing
    // to dub yet, so they shouldn't clutter the public library.
    if (u.segments.length < 1) continue;

    let shareId = u.shareId;
    if (!shareId || shareId.length !== SHARE_ID_LENGTH) {
      shareId = await generateShareId();
      await db.videoUpload.update({ where: { id: u.id }, data: { shareId } });
    }
    const creator = u.userId ? userById.get(u.userId) : undefined;
    const players = new Set(u.segments.map((s) => s.player ?? 1)).size;
    const rating = ratingByUpload.get(u.id);
    videos.push({
      id: u.id,
      title: u.title,
      shareId,
      status: u.status,
      sourceUrl: u.sourceUrl,
      durationMs: u.durationMs,
      lines: u.segments.length,
      players,
      creator: creator?.displayName || "Anonymous",
      creatorColor: creator?.avatarColor || "#6F48FF",
      // Average 0–5 rank and how many players have rated it (0 = unrated yet).
      rating: rating ? Math.round(rating.avg * 10) / 10 : 0,
      ratingCount: rating?.count ?? 0,
      createdAt: u.createdAt,
    });
  }

  return NextResponse.json({ videos });
}
