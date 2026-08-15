import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

/**
 * robots.txt, and the sitemap pointer Search Console looks for.
 *
 * The API routes are disallowed one by one rather than as `/api/`. That blanket
 * rule would also cover `/api/share/[slug]`, which is where every OG image is
 * rendered — and the crawlers that fetch those images read robots.txt first, so
 * blocking the folder would turn every shared dish link into a preview with no
 * picture. The routes named here are the ones with nothing to crawl: a model
 * endpoint, an analytics beacon, a device-scoped thread mirror.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/chat", "/api/track", "/api/conversations", "/api/health", "/api/swap"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
