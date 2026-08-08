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
        ],
      },
    ];
  },
};

export default nextConfig;
