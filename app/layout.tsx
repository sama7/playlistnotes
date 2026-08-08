import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playlistnotes",
  description: "A place to keep what music means to you.",
  // The staging host must never be indexed. Production flips ALLOW_INDEXING.
  robots:
    process.env.ALLOW_INDEXING === "true" ? undefined : { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
