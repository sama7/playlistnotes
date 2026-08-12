import type { MetadataRoute } from "next";

/**
 * Robots policy.
 *
 * Indexing is off entirely until the canonical domain, redirects and launch
 * surfaces are verified — `ALLOW_INDEXING` is the single switch, and it is off
 * everywhere today.
 *
 * When it is flipped, `/n/` and `/c/` stay disallowed permanently. Those are
 * unlisted share links: addressable on purpose, discoverable never. `/invite`
 * and `/account` are excluded for the same reason — there is nothing there for
 * a search engine and everything there is either private or pointless.
 *
 * Worth remembering what this cannot do: a chat or social client fetching a
 * pasted link for an unfurl ignores this file completely. Keeping private text
 * out of those pages' metadata is what actually protects them.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
  const allowIndexing = process.env.ALLOW_INDEXING === "true";

  if (!allowIndexing) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/n/", "/c/", "/invite", "/account", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
