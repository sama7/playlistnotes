import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Actions builds the deployable artifact and the droplet only runs it.
  // A `next build` spike alongside MKDb and its local PostgreSQL on a 2 GB box
  // risks the OOM killer taking out MKDb's database.
  output: "standalone",

  reactStrictMode: true,

  // The staging host is gated and must never be indexed. Production sets
  // ALLOW_INDEXING explicitly; everything else stays noindex by default.
  async headers() {
    const allowIndexing = process.env.ALLOW_INDEXING === "true";
    return [
      {
        source: "/:path*",
        headers: [
          ...(allowIndexing
            ? []
            : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          /**
           * nginx already 301s HTTP to HTTPS; HSTS is what closes the gap the
           * redirect leaves open, since the first request still travels in the
           * clear. Browsers ignore this header when it arrives over HTTP, so it
           * is safe to send unconditionally.
           *
           * Deliberately without `includeSubDomains` and without `preload`:
           * both commit sibling hostnames — and, for preload, a hardcoded
           * browser list that is slow to undo — on behalf of an apex that is
           * still v1 on Heroku. Those are decisions for cutover, not for a
           * staging host.
           */
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
