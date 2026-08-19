import db from "@/lib/db";
import { SEED_CREATORS, LINK_PLATFORMS, type Creator, type CreatorWork, type CreatorLink } from "@/lib/creators";

const PLATFORM_KEYS = new Set(LINK_PLATFORMS.map((p) => p.key));

// Coerce the stored/submitted links into a clean [{platform,url}] array: drop
// anything without a real url, and fall back to the "other" platform for unknown
// keys so a bad value can never break rendering.
function parseLinks(v: unknown): CreatorLink[] {
  if (!Array.isArray(v)) return [];
  const out: CreatorLink[] = [];
  for (const item of v) {
    const url = typeof (item as CreatorLink)?.url === "string" ? (item as CreatorLink).url.trim() : "";
    if (!url) continue;
    const p = typeof (item as CreatorLink)?.platform === "string" ? (item as CreatorLink).platform : "other";
    out.push({ platform: PLATFORM_KEYS.has(p) ? p : "other", url });
  }
  return out;
}

// DB helpers for featured creators, shared by the public (/api/creators) and
// admin (/api/admin/creators) routes so the serialized shape stays identical.

type VideoRow = {
  id: string;
  title: string;
  shareId: string | null;
  sourceUrl: string;
  durationMs: number;
  segments: { player: number | null }[];
};
type CreatorRow = {
  id: string;
  handle: string;
  name: string;
  tagline: string;
  bio: string;
  avatar: string;
  color: string;
  instagram: string;
  links: unknown;
  verified: boolean;
  videos: VideoRow[];
};

function serializeVideo(v: VideoRow): CreatorWork {
  return {
    id: v.id,
    title: v.title,
    shareId: v.shareId ?? "",
    sourceUrl: v.sourceUrl,
    durationMs: v.durationMs,
    lines: v.segments.length,
    players: new Set(v.segments.map((s) => s.player ?? 1)).size,
  };
}

export function serializeCreator(c: CreatorRow): Creator {
  return {
    id: c.id,
    handle: c.handle,
    name: c.name,
    tagline: c.tagline,
    bio: c.bio,
    avatar: c.avatar,
    color: c.color,
    instagram: c.instagram,
    links: parseLinks(c.links),
    verified: c.verified,
    works: c.videos.map(serializeVideo),
  };
}

// Insert the seed creator PROFILE(s) the first time the table is empty. Safe
// under concurrent calls: the unique `handle` makes a duplicate insert throw,
// which we swallow.
export async function seedIfEmpty(): Promise<void> {
  if ((await db.creator.count()) > 0) return;
  for (let i = 0; i < SEED_CREATORS.length; i++) {
    try {
      await db.creator.create({ data: { ...SEED_CREATORS[i], sort: i } });
    } catch {
      /* already seeded by a concurrent request — ignore */
    }
  }
}

// List creators with their videos. Public callers get only playable videos
// (those with sectors); admins (`admin: true`) get every video so unedited ones
// can still be opened in the editor.
export async function listCreators(opts: { admin?: boolean } = {}): Promise<Creator[]> {
  await seedIfEmpty();
  const rows = await db.creator.findMany({
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    include: {
      videos: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          shareId: true,
          sourceUrl: true,
          durationMs: true,
          segments: { select: { player: true } },
        },
      },
    },
  });
  return rows.map((c) => {
    const creator = serializeCreator(c as CreatorRow);
    if (!opts.admin) creator.works = creator.works.filter((w) => w.lines > 0);
    return creator;
  });
}

// ── Profile input parsing/validation for the admin create/update routes ──────
export type CreatorInput = {
  handle?: string;
  name?: string;
  tagline?: string;
  bio?: string;
  avatar?: string;
  color?: string;
  instagram?: string;
  links?: unknown;
  verified?: boolean;
};

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);

// Normalise a handle to a url-safe slug (lowercase, a–z0–9 and dashes).
export const slugifyHandle = (v: unknown) =>
  str(v)
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function creatorData(body: CreatorInput) {
  return {
    name: str(body.name),
    tagline: str(body.tagline),
    bio: str(body.bio),
    avatar: str(body.avatar),
    color: str(body.color) || "#FF3D8B",
    instagram: str(body.instagram),
    links: parseLinks(body.links),
    verified: body.verified === true,
  };
}
