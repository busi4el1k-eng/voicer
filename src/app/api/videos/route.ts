import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { ALL_LANG, BASE_SELECT, type BaseRow, libraryWhere, serializeRows } from "@/lib/library-videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
// Cap for the *aggregate* sorts only (trending / rated / popular), which must
// rank across the library in memory. The default/newest + other column sorts
// paginate directly in the DB with no cap.
const SCAN_CAP = 500;

type SortField = "trending" | "date" | "rating" | "popular" | "sectors" | "length";
type SortDir = "asc" | "desc";

const SORT_FIELDS: readonly SortField[] = [
  "trending",
  "date",
  "rating",
  "popular",
  "sectors",
  "length",
];

// Column sorts the DB can order directly (no library scan). Aggregate sorts
// (trending / rating / popular) return null and take the scan path.
const dbOrderBy = (
  field: SortField,
  dir: SortDir,
): Prisma.VideoUploadOrderByWithRelationInput | null => {
  switch (field) {
    case "date":
      return { createdAt: dir };
    case "length":
      return { durationMs: dir };
    case "sectors":
      return { segments: { _count: dir } };
    default:
      return null; // trending / rating / popular → aggregate scan
  }
};

// Aggregate-sort path: rank across the (language-scoped, capped) library by a
// play/rating-derived score, then return the requested page. Only runs when the
// user actually picks Trending / Most-rated / Most-popular.
async function aggregatePage(
  where: Prisma.VideoUploadWhereInput,
  field: SortField,
  dir: SortDir,
  page: number,
  pageSize: number,
) {
  const rows = await db.videoUpload.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: SCAN_CAP,
    select: { ...BASE_SELECT },
  });
  const ids = rows.map((r) => r.id);
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const [ratingRows, playRows, todayPlayRows, segRows] = ids.length
    ? await Promise.all([
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
        db.videoSegment.groupBy({
          by: ["uploadId"],
          where: { uploadId: { in: ids } },
          _count: true,
        }),
      ])
    : [[], [], [], []];
  const ratingByUpload = new Map(
    ratingRows.map((r) => [r.uploadId, { avg: r._avg.stars ?? 0, count: r._count }]),
  );
  const playsByUpload = new Map(playRows.map((r) => [r.uploadId, r._count]));
  const todayPlaysByUpload = new Map(todayPlayRows.map((r) => [r.uploadId, r._count]));
  const linesByUpload = new Map(segRows.map((r) => [r.uploadId, r._count]));

  const score = (r: BaseRow): number => {
    const rating = ratingByUpload.get(r.id);
    const avg = rating ? rating.avg : 0;
    const count = rating?.count ?? 0;
    const plays = playsByUpload.get(r.id) ?? 0;
    const todayPlays = todayPlaysByUpload.get(r.id) ?? 0;
    switch (field) {
      case "rating":
        return avg;
      case "popular":
        return count * 6 + avg;
      case "trending": {
        const ageHours = Math.max(0, (Date.now() - r.createdAt.getTime()) / 3_600_000) || 0;
        const engagement = todayPlays * 8 + plays + count * 2 + avg;
        return engagement / Math.pow(ageHours + 2, 1.5);
      }
      default:
        return linesByUpload.get(r.id) ?? 0;
    }
  };

  const mul = dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => (score(a) - score(b)) * mul);
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const hasNext = page * pageSize < sorted.length;
  return { pageRows, hasNext };
}

// The shared Video library, paginated. The client only ever pulls one page; the
// language counts + trending sidebar come from /api/videos/facets (loaded
// separately so they never block the first page of videos).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || "", 10) || DEFAULT_PAGE_SIZE),
  );
  const sParam = url.searchParams.get("sort") as SortField | null;
  const sortField: SortField = sParam && SORT_FIELDS.includes(sParam) ? sParam : "date";
  const dir: SortDir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const lang = url.searchParams.get("lang") || ALL_LANG;
  const where = libraryWhere(lang);

  const orderBy = dbOrderBy(sortField, dir);
  let pageRows: BaseRow[];
  let hasNext: boolean;
  if (orderBy) {
    // Fast path: order + paginate in the DB. Fetch one extra row to know whether
    // a next page exists without counting the whole library.
    const rows = await db.videoUpload.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: { ...BASE_SELECT },
    });
    hasNext = rows.length > pageSize;
    pageRows = rows.slice(0, pageSize);
  } else {
    ({ pageRows, hasNext } = await aggregatePage(where, sortField, dir, page, pageSize));
  }

  return NextResponse.json({ videos: await serializeRows(pageRows), page, hasNext });
}
