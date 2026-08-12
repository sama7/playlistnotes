import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrackJot",
  description: "A place to keep what music means to you.",
  // The staging host must never be indexed. Production flips ALLOW_INDEXING.
  robots:
    process.env.ALLOW_INDEXING === "true" ? undefined : { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
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
          <div id="content">{children}</div>
        </body>
      </html>
    </ClerkProvider>
  );
}
