import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { generateShareId } from "@/lib/share-id.server";
import { SHARE_ID_LENGTH } from "@/lib/share-id";
import { LOCALES } from "@/lib/i18n";

export const ALL_LANG = "all";
export const OTHER_LANG = "other";

// The base columns we serialize for a library card. Kept minimal — aggregates
// (sectors, players, ratings, plays) are added per-batch, not carried in the row.
export const BASE_SELECT = {
  id: true,
  title: true,
  language: true,
  shareId: true,
  status: true,
  sourceUrl: true,
  durationMs: true,
  userId: true,
  createdAt: true,
} satisfies Prisma.VideoUploadSelect;

export type BaseRow = Prisma.VideoUploadGetPayload<{ select: typeof BASE_SELECT }>;

// The serialized library-card shape sent to the client.
export type LibraryVideo = {
  id: string;
  title: string;
  language: string;
  shareId: string | null;
  status: string;
  sourceUrl: string;
  durationMs: number;
  lines: number;
  players: number;
  creator: string;
  creatorColor: string;
  rating: number;
  ratingCount: number;
  playCount: number;
  todayPlayCount: number;
  createdAt: Date;
};

// The library's WHERE: public community uploads (never a creator's) that
// actually have at least one cut sector — pushed into the DB so we never load a
// video only to drop it, and never scan the whole table to count.
export const libraryWhere = (lang: string): Prisma.VideoUploadWhereInput => {
  const base: Prisma.VideoUploadWhereInput = {
    visibility: "public",
    creatorId: null,
    segments: { some: {} },
  };
  if (lang === ALL_LANG) return base;
  if (lang === OTHER_LANG)
    return { ...base, NOT: { language: { in: LOCALES as unknown as string[] } } };
  if ((LOCALES as readonly string[]).includes(lang)) return { ...base, language: lang };
  return base;
};

// Attach aggregates to a set of base rows and serialize them into the library
// card shape, preserving the given order. One batched query per aggregate, so
// this scales with the number of rows passed (a page, or the whole library).
export async function serializeRows(rows: BaseRow[]): Promise<LibraryVideo[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [segRows, ratingRows, playRows, todayPlayRows] = await Promise.all([
    db.videoSegment.groupBy({
      by: ["uploadId", "player"],
      where: { uploadId: { in: ids } },
      _count: { _all: true },
    }),
    db.videoRating.groupBy({
      by: ["uploadId"],
      where: { uploadId: { in: ids } },
      _avg: { stars: true },
      _count: true,
    }),
    db.videoPlay.groupBy({ by: ["uploadId"], where: { uploadId: { in: ids } }, _count: true }),
    db.videoPlay.groupBy({
      by: ["uploadId"],
      where: { uploadId: { in: ids }, createdAt: { gte: startOfToday } },
      _count: true,
    }),
  ]);

  const lines = new Map<string, number>();
  const players = new Map<string, number>();
  for (const r of segRows) {
    lines.set(r.uploadId, (lines.get(r.uploadId) ?? 0) + r._count._all);
    players.set(r.uploadId, (players.get(r.uploadId) ?? 0) + 1);
  }
  const ratingByUpload = new Map(
    ratingRows.map((r) => [r.uploadId, { avg: r._avg.stars ?? 0, count: r._count }]),
  );
  const playsByUpload = new Map(playRows.map((r) => [r.uploadId, r._count]));
  const todayPlaysByUpload = new Map(todayPlayRows.map((r) => [r.uploadId, r._count]));

  // Resolve creator display names in one batched lookup.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, avatarColor: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Backfill any missing/legacy-length share codes for just these rows.
  const shareIdById = new Map<string, string>();
  for (const r of rows) {
    let shareId = r.shareId;
    if (!shareId || shareId.length !== SHARE_ID_LENGTH) {
      shareId = await generateShareId();
      await db.videoUpload.update({ where: { id: r.id }, data: { shareId } });
    }
    shareIdById.set(r.id, shareId);
  }

  return rows.map((r) => {
    const creator = r.userId ? userById.get(r.userId) : undefined;
    const rating = ratingByUpload.get(r.id);
    return {
      id: r.id,
      title: r.title,
      language: (LOCALES as readonly string[]).includes(r.language ?? "") ? r.language! : "",
      shareId: shareIdById.get(r.id) ?? r.shareId,
      status: r.status,
      sourceUrl: r.sourceUrl,
      durationMs: r.durationMs,
      lines: lines.get(r.id) ?? 0,
      players: players.get(r.id) ?? 0,
      creator: creator?.displayName || "Anonymous",
      creatorColor: creator?.avatarColor || "#6F48FF",
      rating: rating ? Math.round(rating.avg * 10) / 10 : 0,
      ratingCount: rating?.count ?? 0,
      playCount: playsByUpload.get(r.id) ?? 0,
      todayPlayCount: todayPlaysByUpload.get(r.id) ?? 0,
      createdAt: r.createdAt,
    };
  });
}
