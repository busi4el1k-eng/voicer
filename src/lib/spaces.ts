import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

// DigitalOcean Spaces access, same construction as
// ../digital_standarts/src/app/api/products-library/route.ts.
// Bucket "digital-standart-lib", region fra1, our content lives under "voicer/".
export const SPACES_BUCKET = process.env.DO_SPACES_BUCKET || "digital-standart-lib";
export const SPACES_PREFIX = process.env.DO_SPACES_PREFIX || "voicer/";
const ENDPOINT = process.env.DO_SPACES_ENDPOINT || "https://fra1.digitaloceanspaces.com";
const REGION = process.env.DO_SPACES_REGION || "fra1";

// Public base for read-only file URLs (objects with public ACL).
const PUBLIC_BASE =
  process.env.NEXT_PUBLIC_SPACES_PUBLIC_BASE ||
  "https://digital-standart-lib.fra1.digitaloceanspaces.com";

export function spacesConfigured(): boolean {
  return !!(process.env.DO_SPACES_KEY && process.env.DO_SPACES_SECRET);
}

// Listing/writing needs credentials; reading public objects only needs the URL.
export function getSpaces(): S3Client {
  return new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: {
      accessKeyId: process.env.DO_SPACES_KEY!,
      secretAccessKey: process.env.DO_SPACES_SECRET!,
    },
    forcePathStyle: false,
  });
}

// Build the public URL for a key. Accepts keys with or without the voicer prefix.
export function publicUrl(key: string): string {
  const clean = key.replace(/^\/+/, "");
  return `${PUBLIC_BASE}/${clean}`;
}

// Upload a buffer, public-read by default (so the browser can stream it).
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  publicRead = true,
): Promise<{ key: string; url: string }> {
  await getSpaces().send(
    new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: publicRead ? "public-read" : "private",
    }),
  );
  return { key, url: publicUrl(key) };
}

// Delete objects by key (best-effort). Used when removing an upload and its
// cut clips. Ignores empty input; S3 caps a batch at 1000 keys.
export async function deleteObjects(keys: string[]): Promise<void> {
  const clean = keys.filter(Boolean).map((k) => k.replace(/^\/+/, ""));
  if (clean.length === 0) return;
  await getSpaces().send(
    new DeleteObjectsCommand({
      Bucket: SPACES_BUCKET,
      Delete: { Objects: clean.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

// Download an object into a Buffer (used to feed ffmpeg / OpenAI).
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await getSpaces().send(
    new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

// Never leak credentials in error responses — mirror the reference's sanitizer.
export function describeS3Error(err: unknown) {
  const e = err as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return {
    name: e?.name ?? "Error",
    message: String(e?.message ?? err ?? "Unknown"),
    code: e?.Code ?? null,
    httpStatusCode: e?.$metadata?.httpStatusCode ?? null,
  };
}
