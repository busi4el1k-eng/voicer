import { NextResponse } from "next/server";
import { ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { SPACES_BUCKET, SPACES_PREFIX, getSpaces, publicUrl, spacesConfigured, describeS3Error } from "@/lib/spaces";

// Lists the voicer content library from DigitalOcean Spaces. Same style as
// ../digital_standarts products-library: list folders via CommonPrefixes, then
// recurse into Contents. Structure it reads (see docs/SPACES_STRUCTURE.md):
//
//   voicer/packs/<pack>/pack.json
//   voicer/packs/<pack>/cover.jpg
//   voicer/packs/<pack>/scenes/<scene>/scene.json
//   voicer/packs/<pack>/scenes/<scene>/audio.(mp3|ogg|wav)
//   voicer/packs/<pack>/scenes/<scene>/video.mp4
//   voicer/packs/<pack>/scenes/<scene>/poster.jpg

export const revalidate = 3600;
export const runtime = "nodejs";

const PACKS_PREFIX = `${SPACES_PREFIX}packs/`;

type SceneMedia = { audio?: string; video?: string; poster?: string; meta?: string };
type SceneEntry = { slug: string; media: SceneMedia };
type PackEntry = { slug: string; cover?: string; meta?: string; scenes: SceneEntry[] };

function classify(key: string): keyof SceneMedia | "cover" | null {
  const lower = key.toLowerCase();
  if (/\/audio\.(mp3|ogg|wav|m4a)$/.test(lower)) return "audio";
  if (/\/video\.(mp4|webm|mov)$/.test(lower)) return "video";
  if (/\/poster\.(jpg|jpeg|png|webp)$/.test(lower)) return "poster";
  if (/\/scene\.json$/.test(lower)) return "meta";
  return null;
}

export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");

  if (!spacesConfigured()) {
    // No credentials → return an empty library rather than erroring, so the
    // dashboard's pack browser degrades gracefully (local packs still show).
    if (debug) {
      return NextResponse.json(
        { ok: false, reason: "missing_credentials", bucket: SPACES_BUCKET, prefix: PACKS_PREFIX },
        { status: 200 },
      );
    }
    return NextResponse.json({ configured: false, packs: [] });
  }

  try {
    const s3 = getSpaces();

    // Step 1: pack folders directly under voicer/packs/
    const packSlugs: string[] = [];
    let token: string | undefined;
    do {
      const res: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({
          Bucket: SPACES_BUCKET,
          Prefix: PACKS_PREFIX,
          Delimiter: "/",
          MaxKeys: 1000,
          ContinuationToken: token,
        }),
      );
      for (const cp of res.CommonPrefixes ?? []) {
        const name = cp.Prefix?.replace(PACKS_PREFIX, "").replace(/\/$/, "");
        if (name) packSlugs.push(name);
      }
      token = res.NextContinuationToken;
    } while (token);

    // Step 2: for each pack, list everything under it and group by scene folder.
    const packs: PackEntry[] = await Promise.all(
      packSlugs.sort((a, b) => a.localeCompare(b)).map(async (slug) => {
        const packPrefix = `${PACKS_PREFIX}${slug}/`;
        const scenes = new Map<string, SceneMedia>();
        const pack: PackEntry = { slug, scenes: [] };

        let t: string | undefined;
        do {
          const res: ListObjectsV2CommandOutput = await s3.send(
            new ListObjectsV2Command({
              Bucket: SPACES_BUCKET,
              Prefix: packPrefix,
              MaxKeys: 1000,
              ContinuationToken: t,
            }),
          );
          for (const obj of res.Contents ?? []) {
            const key = obj.Key;
            if (!key) continue;
            const rel = key.slice(packPrefix.length);
            if (rel === "pack.json") pack.meta = publicUrl(key);
            else if (/^cover\.(jpg|jpeg|png|webp)$/i.test(rel)) pack.cover = publicUrl(key);
            else if (rel.startsWith("scenes/")) {
              const sceneSlug = rel.split("/")[1];
              if (!sceneSlug) continue;
              const kind = classify(key);
              if (!kind || kind === "cover") continue;
              const media = scenes.get(sceneSlug) ?? {};
              media[kind] = publicUrl(key);
              scenes.set(sceneSlug, media);
            }
          }
          t = res.NextContinuationToken;
        } while (t);

        pack.scenes = [...scenes.entries()]
          .map(([sceneSlug, media]) => ({ slug: sceneSlug, media }))
          .sort((a, b) => a.slug.localeCompare(b.slug));
        return pack;
      }),
    );

    if (debug) {
      return NextResponse.json({
        ok: true,
        bucket: SPACES_BUCKET,
        prefix: PACKS_PREFIX,
        packCount: packs.length,
        sceneCount: packs.reduce((n, p) => n + p.scenes.length, 0),
        sample: packs.slice(0, 2),
      });
    }
    return NextResponse.json({ configured: true, packs });
  } catch (err) {
    const detail = describeS3Error(err);
    console.error("[Library] Spaces listing failed:", detail);
    if (debug) return NextResponse.json({ ok: false, reason: "s3_error", error: detail }, { status: 500 });
    return NextResponse.json({ configured: false, packs: [] });
  }
}
