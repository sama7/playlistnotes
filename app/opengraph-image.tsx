import { ImageResponse } from "next/og";

/**
 * The link preview card, generated rather than designed as a binary.
 *
 * Generated for two reasons that matter more than convenience: it stays in sync
 * with the palette in globals.css instead of drifting from it, and it survives
 * a rename — the last one would otherwise have left a PNG saying Playlistnotes
 * in every previously shared link.
 *
 * This is the ROOT card only, and it deliberately says nothing specific. The
 * shared note and collection routes override it, because a chat client fetching
 * a pasted link for an unfurl ignores robots directives entirely: whatever ends
 * up here is effectively public the moment someone pastes the URL anywhere.
 */

export const alt = "TrackJot — a private music journal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#121215",
          color: "#ececf0",
          fontFamily: "sans-serif",
        }}
      >
        {/* The same two marks as the favicon: a track line, and a jot across it. */}
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 48 }}>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#ececf0" />
            <line x1="14" y1="38" x2="50" y2="38" stroke="#16161a" strokeWidth="5" strokeLinecap="round" />
            <path
              d="M20 44 C27 24, 35 20, 44 27"
              fill="none"
              stroke="#3b4cca"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
          <div style={{ fontSize: 40, letterSpacing: "0.18em", color: "#9a9aa6" }}>TRACKJOT</div>
        </div>

        <div style={{ fontSize: 76, lineHeight: 1.1, fontWeight: 600 }}>
          Keep what music means to you.
        </div>

        <div style={{ fontSize: 34, color: "#9a9aa6", marginTop: 32, maxWidth: 900 }}>
          Paste a track. Jot what you want to remember. Everything starts private.
        </div>
      </div>
    ),
    size,
  );
}
