import { type NextRequest } from "next/server";
import { SPACES_PUBLIC_BASE } from "@/lib/spaces";

export const runtime = "nodejs";

// Force-download proxy. A cross-origin <a download> to DigitalOcean Spaces is
// ignored by browsers (the file just opens in a new tab), so instead we stream
// the object back through our own origin with Content-Disposition: attachment.
// Guarded to our public bucket base so it can't be used as an open proxy/SSRF.
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const target = params.get("url") ?? "";
  const rawName = params.get("name") ?? "video.mp4";

  if (!target.startsWith(`${SPACES_PUBLIC_BASE}/`)) {
    return new Response("Invalid download URL.", { status: 400 });
  }

  // Strip anything that could break the header or path; keep a safe filename.
  const filename =
    rawName.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "video.mp4";

  let upstream: Response;
  try {
    upstream = await fetch(target);
  } catch {
    return new Response("Couldn't reach storage.", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("File not available.", { status: 502 });
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);

  return new Response(upstream.body, { status: 200, headers });
}
