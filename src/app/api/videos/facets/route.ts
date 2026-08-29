import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { LOCALES } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_LANG = "all";
const OTHER_LANG = "other";
const TRENDING_COUNT = 5;

// Same library filter as the list endpoint, minus the language narrowing (which
// we apply per-call for trending).
const baseWhere: Prisma.VideoUploadWhereInput = {
  visibility: "public",
  creatorId: null,
  segments: { some: {} },
};

const langWhere = (lang: string): Prisma.VideoUploadWhereInput => {
  if (lang === ALL_LANG) return baseWhere;
  if (lang === OTHER_LANG)
    return { ...baseWhere, NOT: { language: { in: LOCALES as unknown as string[] } } };
  if ((LOCALES as readonly string[]).includes(lang)) return { ...baseWhere, language: lang };
  return baseWhere;
};

// The library's non-list facets: per-language counts (for the filter tabs), the
// total, and the "Trending today" window. Loaded on its own so the first page
// of videos can paint before any library-wide work runs.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || ALL_LANG;

  // 1. Per-language counts straight from the indexed `language` column — no rows
  //    loaded. Non-locale / null buckets collapse into "other".
  const grouped = await db.videoUpload.groupBy({
    by: ["language"],
    where: baseWhere,
    _count: true,
  });
  const langCounts: Record<string, number> = {};
  let totalAll = 0;
  for (const g of grouped) {
    const bucket = (LOCALES as readonly string[]).includes(g.language ?? "")
      ? (g.language as string)
      : OTHER_LANG;
    langCounts[bucket] = (langCounts[bucket] ?? 0) + g._count;
    totalAll += g._count;
  }

  // 2. Trending window for the selected language. We rank by today's runs, then
  //    fall back to all-time runs on a quiet day. Only the ids in the current
  //    language are considered, and only the top few are hydrated.
  const langIds = (
    await db.videoUpload.findMany({ where: langWhere(lang), select: { id: true } })
  ).map((r) => r.id);

  let trendingVideos: { id: string; title: string; shareId: string | null; playCount: number; todayPlayCount: number }[] = [];
  let fallback = false;
  if (langIds.length) {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const todayRows = await db.videoPlay.groupBy({
      by: ["uploadId"],
      where: { uploadId: { in: langIds }, createdAt: { gte: startOfToday } },
      _count: true,
      orderBy: { _count: { uploadId: "desc" } },
      take: TRENDING_COUNT,
    });
    let topIds = todayRows.map((r) => r.uploadId);
    if (topIds.length === 0) {
      fallback = true;
      const allTimeRows = await db.videoPlay.groupBy({
        by: ["uploadId"],
        where: { uploadId: { in: langIds } },
        _count: true,
        orderBy: { _count: { uploadId: "desc" } },
        take: TRENDING_COUNT,
      });
      topIds = allTimeRows.map((r) => r.uploadId);
    }

    if (topIds.length) {
      const [uploads, allTimeCounts, todayCounts] = await Promise.all([
        db.videoUpload.findMany({
          where: { id: { in: topIds } },
          select: { id: true, title: true, shareId: true },
        }),
        db.videoPlay.groupBy({ by: ["uploadId"], where: { uploadId: { in: topIds } }, _count: true }),
        db.videoPlay.groupBy({
          by: ["uploadId"],
          where: { uploadId: { in: topIds }, createdAt: { gte: startOfToday } },
          _count: true,
        }),
      ]);
      const byId = new Map(uploads.map((u) => [u.id, u]));
      const allTimeById = new Map(allTimeCounts.map((r) => [r.uploadId, r._count]));
      const todayById = new Map(todayCounts.map((r) => [r.uploadId, r._count]));
      // Preserve the ranked order from the groupBy above.
      trendingVideos = topIds
        .map((id) => {
          const u = byId.get(id);
          if (!u) return null;
          return {
            id: u.id,
            title: u.title,
            shareId: u.shareId,
            playCount: allTimeById.get(id) ?? 0,
            todayPlayCount: todayById.get(id) ?? 0,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
    }
  }

  return NextResponse.json({
    langCounts,
    totalAll,
    trending: { videos: trendingVideos, fallback },
  });
}
