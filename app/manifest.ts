import type { MetadataRoute } from "next";

/**
 * Web app manifest, so an installed TrackJot looks like itself rather than a
 * browser tab. `display: minimal-ui` rather than `standalone` on purpose — this
 * is a place people read and write text, and keeping the URL bar means a share
 * link can still be copied out of an installed window.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrackJot",
    short_name: "TrackJot",
    description: "A private music journal.",
    start_url: "/notes",
    display: "minimal-ui",
    background_color: "#121215",
    theme_color: "#121215",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
