import type { MetadataRoute } from "next";

// The public, indexable content pages — given to search engines so they crawl
// these (and not the gated app routes disallowed in robots.ts). Referenced by
// robots.ts as the Sitemap URL.
const SITE = "https://dubthatmovie.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: { path: string; changeFrequency: "daily" | "monthly"; priority: number }[] = [
    { path: "/", changeFrequency: "monthly", priority: 1 },
    { path: "/library", changeFrequency: "daily", priority: 0.9 },
    { path: "/about", changeFrequency: "monthly", priority: 0.6 },
    { path: "/contact", changeFrequency: "monthly", priority: 0.6 },
    { path: "/privacy", changeFrequency: "monthly", priority: 0.4 },
  ];
  return pages.map((p) => ({
    url: `${SITE}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
