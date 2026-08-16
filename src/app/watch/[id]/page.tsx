import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { VideoStage } from "@/components/VideoStage";
import { WatchActions } from "@/components/WatchActions";
import { DEFAULT_LOCALE, isLocale, translate } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A watchable dub, normalised from either an explicitly-shared dub (SharedDub)
// or a podium clip (Clip, which carries no title of its own → use the source
// video's title). Lets one /watch/<id> page serve both.
type Watchable = { title: string; videoUrl: string };

async function getShare(id: string): Promise<Watchable | null> {
  try {
    const share = await db.sharedDub.findUnique({ where: { id } });
    if (share) return { title: share.title, videoUrl: share.videoUrl };
    const clip = await db.clip.findUnique({
      where: { id },
      include: { upload: { select: { title: true } } },
    });
    if (clip) return { title: clip.upload.title, videoUrl: clip.videoUrl };
    return null;
  } catch {
    return null; // db unreachable — treat as missing rather than 500
  }
}

// Show the dub's title (or a default) in the browser tab / link preview.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const share = await getShare(id);
  const title = share?.title ? `${share.title} · Cinema Dub` : "Cinema Dub";
  return {
    title,
    description: "Watch this dub, made with Cinema Dub.",
    openGraph: { title, videos: share ? [share.videoUrl] : undefined },
  };
}

// Public watch page — anyone with the link can open it, no account needed. Just
// plays the shared dub and invites the viewer to make their own.
export default async function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const share = await getShare(id);

  // Match the rest of the app: paint in the viewer's chosen language (cookie).
  const cookieLocale = (await cookies()).get("cinemadub.locale")?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = (key: string) => translate(locale, key);

  return (
    <main className="g-screen">
      <div className="flex h-[72px] items-center">
        <Link href="/" className="g-logo">
          Cinema Dub
        </Link>
      </div>

      <div className="w-full max-w-2xl">
        {share ? (
          <div className="g-panel text-center">
            <h2 className="g-title">{share.title || t("watch.untitled")}</h2>
            <p className="mb-4 text-[13px] text-cream/60">{t("watch.subtitle")}</p>
            <div className="mb-4">
              <VideoStage src={share.videoUrl} />
            </div>
            <WatchActions />
          </div>
        ) : (
          <div className="g-panel text-center">
            <h2 className="g-title">{t("watch.notFoundTitle")}</h2>
            <p className="mb-4 text-[13px] text-cream/60">{t("watch.notFoundBody")}</p>
            <Link href="/dashboard" className="g-btn g-btn-start mx-auto">
              {t("watch.goToDashboard")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
