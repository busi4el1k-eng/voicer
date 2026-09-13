import type { Metadata } from "next";
import db from "@/lib/db";
import { ALL_LANG, BASE_SELECT, libraryWhere, serializeRows } from "@/lib/library-videos";
import { LibraryBrowser, type Video } from "./LibraryBrowser";

// Always reflect the live public library (and never statically prerender an
// empty shell). The heavy client browser hydrates on top of this.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Video Library — community movie & video scenes to dub · DubThatMovie",
  description:
    "Browse the DubThatMovie community library: short movie and video scenes ready to re-voice. " +
    "Pick a clip and dub it solo, in a party, or in a head-to-head duel — free in your browser.",
  alternates: { canonical: "/library" },
};

// How many cards to render server-side. Matches the client page size so the
// first paint is a full page and hydration lines up with no reflow.
const INITIAL_COUNT = 24;

// Fetch the newest page of public library videos server-side. Newest-first is a
// deterministic order (no time-decay maths), so the server HTML and the first
// client render match; the interactive trending sort takes over after hydration.
async function loadInitialVideos(): Promise<Video[]> {
  const rows = await db.videoUpload.findMany({
    where: libraryWhere(ALL_LANG),
    orderBy: { createdAt: "desc" },
    take: INITIAL_COUNT,
    select: { ...BASE_SELECT },
  });
  const serialized = await serializeRows(rows);
  // The client card shape carries the date as an ISO string.
  return serialized.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }));
}

export default async function LibraryPage() {
  let initialVideos: Video[] = [];
  try {
    initialVideos = await loadInitialVideos();
  } catch {
    // A DB hiccup shouldn't blank the page — the client still loads the full
    // library manifest and shows its own loading state.
    initialVideos = [];
  }
  return <LibraryBrowser initialVideos={initialVideos} />;
}
