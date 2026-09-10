import { Provider } from "@prisma/client";
import { searchAppleTracks } from "@/lib/music/apple/itunes";
import { searchSpotifyTracks } from "@/lib/music/spotify/web-api";
import { normalizedKey, normalizeText } from "@/lib/music/normalize";
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
 * to show first; a person decides what is true. And a candidate that does not
 * clear the plausibility floor below is never shown at all, however high a
 * provider's own search ranked it.
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
 * ## The relevance floor
 *
 * Ranking is not the same as qualifying, and for a while this only ranked.
 * Every candidate a provider returned for the search words was shown, ordered
 * by score, so a scrobble of "206" by Joe James offered "Last Day (feat. Juicy
 * J, Lloyd Banks)" by Joe Budden and two unrelated tracks called "Petit
 * prince". Those scored zero or below and were still displayed, because the
 * only thing standing between a result and the screen was `slice(0, limit)`.
 *
 * That is worse than showing nothing. A picker exists to let someone confirm an
 * identity, and padding it with things that are visibly not the track teaches
 * them to distrust the whole list — including the one row that is right.
 *
 * So candidacy is now a gate rather than a score: a suggestion has to plausibly
 * BE this recording, on both title and artist, before it is eligible to be
 * ranked at all. Duration still orders what survives; it cannot admit anything,
 * and it cannot reject anything either — see `isPlausibleMatch`.
 *
 * The two sides are compared differently on purpose:
 *
 *   - **Title** must be a whole-word prefix match in one direction or the
 *     other. Real catalogues add material to the end — "(Remastered 2011)",
 *     "- Live", "(From the Motion Picture)" — and almost never to the front. A
 *     containment test anywhere in the string would let a scrobble of "Love"
 *     match half of recorded music.
 *   - **Artist** is compared as a set of words, because a collaboration is
 *     credited in whatever order each service prefers: "Anyasa" must match
 *     "Anyasa & Kabeer" and "Kabeer, Anyasa" alike. Requiring one side's words
 *     to be wholly contained in the other still rejects "Joe James" against
 *     "Joe Budden", which shares only a first name.
 */

/** Whole-word prefix in either direction: "rasiya" ↔ "rasiya from the film". */
function titlePlausible(candidate: string, known: string): boolean {
  const a = normalizeText(candidate);
  const b = normalizeText(known);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return longer.startsWith(`${shorter} `);
}

/** One credit's words wholly contained in the other's, in either direction. */
function artistPlausible(candidate: string, known: string): boolean {
  const a = new Set(normalizeText(candidate).split(" ").filter(Boolean));
  const b = new Set(normalizeText(known).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) if (!large.has(word)) return false;
  return true;
}

/**
 * Could this candidate be the thing that was played?
 *
 * **Names only — duration is deliberately not a gate here.** It is tempting to
 * disqualify a candidate whose length disagrees wildly, but that would throw
 * away the extended mix and the live cut, which share a title with the original
 * precisely because they *are* the same song, and which someone may well have
 * been listening to. Last.fm scrobbles both as "Rasiya". Duration already earns
 * its keep in `scoreCandidate`, where being wrong costs a candidate its place
 * at the top of the list without costing it its place on the list.
 *
 * The junk this gate exists to remove never fails on length anyway: it fails on
 * being a different song by a different artist.
 */
export function isPlausibleMatch(
  candidate: { title: string; artistName: string },
  known: { title: string; artistName: string },
): boolean {
  return (
    titlePlausible(candidate.title, known.title) &&
    artistPlausible(candidate.artistName, known.artistName)
  );
}

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
    .filter((candidate) => isPlausibleMatch(candidate, known))
    .map((candidate) => ({ ...candidate, ...scoreCandidate(candidate, known) }))
    .sort((a, b) => b.score - a.score || (a.durationDeltaMs ?? 1e9) - (b.durationDeltaMs ?? 1e9))
    .slice(0, limit);
}
