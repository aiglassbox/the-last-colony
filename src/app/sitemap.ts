import type { MetadataRoute } from "next";

import { loadCorpus } from "@/lib/corpus/load";
import { siteUrl } from "@/lib/site-url";

/**
 * The sitemap, served at /sitemap.xml.
 *
 * Built from the same filter `generateStaticParams` uses in the dish route, so
 * the sitemap lists exactly the pages that are actually prerendered — a
 * sitemap that names a URL the app does not build is a 404 reported to Google
 * by the site itself.
 *
 * `lastModified` comes from the record's own verification date rather than the
 * deploy time. A crawler re-reads a page whose date moved, and stamping every
 * entry with "now" on each deploy asks it to re-read the whole corpus every
 * time a stylesheet changes. The date a record was checked is the date its
 * content last meant something different.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();

  const dishes = loadCorpus()
    .records.filter((r) => r.tier === "ancient" || r.provenance_class === "MODERN_DISH")
    .map((r) => ({
      url: `${base}/dish/${r.slug}`,
      lastModified: r.verification.checked_on ? new Date(r.verification.checked_on) : undefined,
      changeFrequency: "monthly" as const,
      // Below the home page, above nothing: these are the pages the campaign
      // points at, and the only ones with content of their own.
      priority: 0.8,
    }));

  return [
    {
      url: base,
      changeFrequency: "weekly" as const,
      priority: 1,
    },
    ...dishes,
  ];
}
