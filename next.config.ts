import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its binary path from __dirname at require time.
  // If Next bundles it into the server output, __dirname is rewritten (e.g.
  // "/ROOT/...") and spawning the binary fails with ENOENT. Keeping it external
  // makes Next use native require() so the real node_modules path is resolved.
  // ffmpeg-static: keep external so its binary path resolves via native require.
  // undici: bundling it into the server output breaks page-data collection at
  // build; keep it a native require so the Demucs client's custom Agent works.
  serverExternalPackages: ["ffmpeg-static", "undici"],
};

export default nextConfig;
