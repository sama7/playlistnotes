import type { MetadataRoute } from "next";

/**
 * The sitemap lists only pages that are genuinely public and genuinely static.
 *
 * Deliberately NOT enumerated: every note and collection. Even the public ones.
 * Listing a share URL in a sitemap is the same as publishing it — it converts
 * "anyone with the link" into "anyone at all", which is not what the person who
 * shared it agreed to. That distinction is the product's core promise, so this
 * file is a place it could quietly be broken.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/sign-in`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
