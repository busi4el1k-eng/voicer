import type { MetadataRoute } from "next";

// Tell crawlers which URLs are public *content* (indexable) and which are the
// app's functional/gated screens (live game sessions, room codes, the editor,
// dashboards, auth, APIs) that have no standalone content and must NOT be judged
// as content pages — that mis-judgement is what triggers AdSense's "ads on pages
// without content" / low-value flags. Public pages: /, /about, /contact,
// /privacy, /library, /watch/*.
const SITE = "https://dubthatmovie.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/party",
        "/play",
        "/creator",
        "/admin",
        "/login",
        "/signup",
        "/api/",
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
