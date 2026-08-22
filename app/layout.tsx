import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

/**
 * Site-wide metadata.
 *
 * `metadataBase` comes from the runtime `APP_BASE_URL` rather than a constant,
 * which is what lets the same artifact serve staging and production and what
 * kept the rename from invalidating anything. Without it, Next resolves
 * relative Open Graph image URLs against localhost and every unfurl breaks
 * silently in a way nothing tests.
 */
const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3100";

const DESCRIPTION =
  "A private music journal. Paste a track, jot what you want to remember, and keep it private until you choose to share.";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "TrackJot",
    // Page titles read "Your notes · TrackJot" without repeating the brand in
    // every individual page's own metadata.
    template: "%s · TrackJot",
  },
  description: DESCRIPTION,
  applicationName: "TrackJot",
  // Indexing stays off until the canonical domain, redirects and launch
  // surfaces are all verified. Production flips ALLOW_INDEXING deliberately.
  robots:
    process.env.ALLOW_INDEXING === "true" ? undefined : { index: false, follow: false },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "TrackJot",
    title: "TrackJot — keep what music means to you",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "TrackJot — keep what music means to you",
    description: DESCRIPTION,
  },
  /**
   * Shared notes and collections must never be *discoverable*, but they are
   * deliberately shareable — and a chat client fetching a link for an unfurl
   * ignores robots directives entirely. Those pages therefore set their own
   * metadata and must never inherit anything describing their contents; see
   * app/n/[token] and app/c/[token].
   */
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Both palettes are declared so the browser chrome matches the page instead
  // of flashing white above a dark document.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121215" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    /**
     * Signing in lands on the notes page, not on the account page.
     *
     * The redirect used to come from `NEXT_PUBLIC_CLERK_*_FALLBACK_REDIRECT_URL`
     * in the environment, pointing at `/account` — so the first thing a new user
     * saw after signing up was a settings screen, which says nothing about what
     * the product is for. Setting it here also removes one more `NEXT_PUBLIC_`
     * value that has to match between the build and the runtime; those have
     * already taken production down once.
     */
    <ClerkProvider
      signInFallbackRedirectUrl="/notes"
      signUpFallbackRedirectUrl="/notes"
    >
      <html lang="en">
        <body>
          {/*
            Visible only on focus, which is exactly when it is wanted. Without
            it a keyboard or screen-reader user traverses the whole header on
            every page before reaching anything they came for.
          */}
          <a href="#content" className="skip-link">
            Skip to content
          </a>
          <SiteNav />
          <div id="content">{children}</div>
          <SiteFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
