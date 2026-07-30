import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its binary path from __dirname at require time.
  // If Next bundles it into the server output, __dirname is rewritten (e.g.
  // "/ROOT/...") and spawning the binary fails with ENOENT. Keeping it external
  // makes Next use native require() so the real node_modules path is resolved.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
