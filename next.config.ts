import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its binary path from __dirname at require time.
  // If Next bundles it into the server output, __dirname is rewritten (e.g.
  // "/ROOT/...") and spawning the binary fails with ENOENT. Keeping it external
  // makes Next use native require() so the real node_modules path is resolved.
  serverExternalPackages: ["ffmpeg-static"],

  experimental: {
    // The proxy (proxy.ts) buffers each request body so it can be read twice.
    // The default 10MB cap silently truncates larger uploads, so /api/creator/
    // upload's formData() parse fails with a 400 ("No file"). Match the nginx
    // client_max_body_size (1024m) so full video uploads make it through.
    proxyClientMaxBodySize: "1024mb",
  },
};

export default nextConfig;
