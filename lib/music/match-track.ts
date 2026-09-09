import { Provider } from "@prisma/client";
import { searchAppleTracks } from "@/lib/music/apple/itunes";
import { searchSpotifyTracks } from "@/lib/music/spotify/web-api";
import { normalizedKey } from "@/lib/music/normalize";
import type { Artwork } from "@/lib/music/artwork";

/**
 * Finding a provider identifier for something we only know by name.
 *
 * ## Why this exists
 *
 * A Last.fm scrobble usually arrives with no MusicBrainz id, which under the
 * catalog policy leaves it creator-scoped and without artwork — correct, but a
 * poor thing to hand someone. Last.fm's own track page *does* link to Apple
 * Music and Spotify, but those links live only in its rendered HTML; no API
 * response carries them, and scraping the page would be fragile and outside
 * what their terms sanction.
 *
 * So the identifier is obtained from the provider directly. It reaches the same
 * place: searching Apple for "Anyasa Rasiya" returns track 1574601348, which is
 * precisely what Last.fm's page links to.
 *
 * ## Why a name search does not violate "entities come from identifiers"
 *
 * Because a search result is a **suggestion shown to a person**, and nothing is
 * created until they say yes. The rule exists to stop a name silently becoming
 * a shared entity; here a human looks at a title, an artist, an album, a
 * duration and a cover, and confirms. What then anchors the recording is the
 * provider's identifier, not the string that found it. That is exactly the
 * "identifier acquisition" promotion path in AGENTS.md §3a.5.
 *
 * **Nothing here auto-links, however confident the score.** Ranking decides what
 * to show first; a person decides what is true.
 */

export interface TrackCandidate {
  provider: Provider;
  providerId: string;
  title: string;
  artistName: string;
  albumName: string | null;
  durationMs: number | null;
  artwork: Artwork;
  providerUrl: string | null;
  /** How far this candidate's length is from the known one, in ms. */
  durationDeltaMs: number | null;
  /** Higher is better. Ordering only — never a threshold for acting alone. */
  score: number;
}

/** Two seconds of slack absorbs encoding differences between catalogues. */
const CLOSE_ENOUGH_MS = 2000;

/**
 * Score a candidate against what we know.
 *
 * Duration does the real work. Titles collide constantly — an original, an
 * extended mix and a DJ mix all called "Rasiya" — and length separates them
 * decisively where a string comparison cannot: 865ms away versus three minutes.
 */
function scoreCandidate(
  candidate: Omit<TrackCandidate, "score" | "durationDeltaMs">,
  known: { title: string; artistName: string; durationMs: number | null },
): { score: number; durationDeltaMs: number | null } {
  let score = 0;

  const sameTrack =
    normalizedKey({ title: candidate.title, artistDisplay: candidate.artistName, durationMs: null }) ===
    normalizedKey({ title: known.title, artistDisplay: known.artistName, durationMs: null });
  if (sameTrack) score += 3;

  if (candidate.title.trim().toLowerCase() === known.title.trim().toLowerCase()) score += 1;
  if (candidate.artistName.trim().toLowerCase() === known.artistName.trim().toLowerCase()) score += 1;

  let durationDeltaMs: number | null = null;
  if (known.durationMs && candidate.durationMs) {
    durationDeltaMs = Math.abs(candidate.durationMs - known.durationMs);
    if (durationDeltaMs <= CLOSE_ENOUGH_MS) score += 4;
    else if (durationDeltaMs <= 10_000) score += 1;
    // A length that disagrees by more than ten seconds is usually a different
    // cut of the same song, so it is pushed down rather than dropped — the
    // person may well have been listening to the extended mix.
    else score -= 2;
  }

  return { score, durationDeltaMs };
}

/**
 * Ask every configured provider for possible matches, best first.
 *
 * Both are queried in parallel and neither can fail the other: a provider that
 * is unconfigured or unreachable simply contributes nothing. Apple needs no
 * credentials at all, so suggestions survive even with every Spotify variable
 * absent — the independence guarantee in AGENTS.md §1.
 */
export async function findTrackCandidates(
  known: { title: string; artistName: string; durationMs: number | null },
  limit = 4,
): Promise<TrackCandidate[]> {
  const term = `${known.artistName} ${known.title}`.trim();
  if (!term) return [];

  const [apple, spotify] = await Promise.all([
    searchAppleTracks(term, 6).catch(() => []),
    searchSpotifyTracks(term, 6).catch(() => []),
  ]);

  const raw: Array<Omit<TrackCandidate, "score" | "durationDeltaMs">> = [
    ...apple.map((a) => ({
      provider: Provider.apple_music,
      providerId: a.providerId,
      title: a.title,
      artistName: a.artistName,
      albumName: a.albumName,
      durationMs: a.durationMs,
      artwork: a.artwork,
      providerUrl: a.providerUrl,
    })),
    ...spotify.map((s) => ({
      provider: Provider.spotify,
      providerId: s.providerId,
      title: s.title,
      artistName: s.artistName,
      albumName: s.albumName,
      durationMs: s.durationMs,
      artwork: s.artwork,
      providerUrl: s.providerUrl,
    })),
  ];

  return raw
    .map((candidate) => ({ ...candidate, ...scoreCandidate(candidate, known) }))
    .sort((a, b) => b.score - a.score || (a.durationDeltaMs ?? 1e9) - (b.durationDeltaMs ?? 1e9))
    .slice(0, limit);
}
