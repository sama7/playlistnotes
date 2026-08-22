import { Provider, PrismaClient } from "@prisma/client";
import { fetchAlbum, fetchPlaylist, fetchTrack } from "@/lib/music/spotify/web-api";
import { fetchAppleAlbum, fetchAppleTrack } from "@/lib/music/apple/itunes";
import { parseSpotifyLink } from "@/lib/music/spotify/parse-link";
import { parseAppleMusicLink } from "@/lib/music/apple/parse-link";
import type { Artwork } from "@/lib/music/artwork";

/**
 * Fill in cover art for rows that predate the artwork columns.
 *
 * Artwork is captured at import time, so everything written before the columns
 * existed has none — and no amount of re-rendering invents it. The identifiers
 * are already stored, which is the whole reason this is recoverable: every row
 * this touches is re-read from the provider that issued its id.
 *
 * Four properties make it safe to run against production:
 *
 *   - **Idempotent.** It only considers rows where `artwork_url IS NULL`, so a
 *     second run is a no-op and an interrupted run resumes.
 *   - **Additive.** It writes two URL columns and nothing else. Nothing is
 *     deleted, no user content is touched, and undoing it is setting them back
 *     to NULL.
 *   - **Dry by default.** It prints what it would do; `--apply` writes.
 *   - **Album-first.** A recording renders its album's cover when it has none of
 *     its own, so albums are backfilled before recordings and only recordings
 *     with no album need their own lookup. That is the difference between one
 *     provider call per album and one per track.
 *
 * It is deliberately sequential with a pause between calls. This is maintenance,
 * not a request path — there is no reason to spend rate limit quickly.
 */

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const PAUSE_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let filled = 0;
let missing = 0;
let failed = 0;

function report(kind: string, name: string, art: Artwork | null): void {
  if (art?.url) {
    filled += 1;
    console.log(`  fill  ${kind.padEnd(11)} ${name.slice(0, 48)}`);
  } else {
    missing += 1;
    console.log(`  none  ${kind.padEnd(11)} ${name.slice(0, 48)}  (provider returned no image)`);
  }
}

/** The provider mapping to use, preferring one we can actually call. */
function pickExternal<T extends { provider: Provider; providerId: string }>(ids: T[]): T | null {
  return (
    ids.find((e) => e.provider === Provider.spotify) ??
    ids.find((e) => e.provider === Provider.apple_music) ??
    null
  );
}

async function backfillAlbums(): Promise<void> {
  const albums = await prisma.album.findMany({
    where: { artworkUrl: null },
    include: { externalIds: true },
  });
  console.log(`\nalbums without artwork: ${albums.length}`);

  for (const album of albums) {
    const ext = pickExternal(album.externalIds);
    if (!ext) {
      console.log(`  skip  album       ${album.title.slice(0, 48)}  (no provider id)`);
      continue;
    }
    try {
      const art =
        ext.provider === Provider.spotify
          ? (await fetchAlbum(ext.providerId))?.artwork
          : (await fetchAppleAlbum(ext.providerId))?.artwork;

      report("album", album.title, art ?? null);
      if (APPLY && art?.url) {
        await prisma.album.update({
          where: { id: album.id },
          data: { artworkUrl: art.url, artworkThumbUrl: art.thumbUrl },
        });
      }
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  album       ${album.title.slice(0, 48)}  ${(error as Error).message}`);
    }
    await sleep(PAUSE_MS);
  }
}

async function backfillRecordings(): Promise<void> {
  /**
   * Only recordings with no album to fall back on. A recording whose album now
   * has a cover already renders one (see `toNoteRow`), so fetching per track
   * here would spend a provider call to store a duplicate of it.
   */
  const recordings = await prisma.recording.findMany({
    where: { artworkUrl: null, OR: [{ albumId: null }, { album: { artworkUrl: null } }] },
    include: { externalIds: true },
  });
  console.log(`\nrecordings still without any cover to show: ${recordings.length}`);

  for (const recording of recordings) {
    const ext = pickExternal(recording.externalIds);
    if (!ext) {
      // Manually entered music. There is nothing to look up and inventing a
      // cover for it would be a small lie about what the user typed.
      console.log(`  skip  recording   ${recording.title.slice(0, 48)}  (user-authored)`);
      continue;
    }
    try {
      const art =
        ext.provider === Provider.spotify
          ? (await fetchTrack(ext.providerId))?.album?.artwork
          : (await fetchAppleTrack(ext.providerId))?.artwork;

      report("recording", recording.title, art ?? null);
      if (APPLY && art?.url) {
        await prisma.recording.update({
          where: { id: recording.id },
          data: { artworkUrl: art.url, artworkThumbUrl: art.thumbUrl },
        });
      }
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  recording   ${recording.title.slice(0, 48)}  ${(error as Error).message}`);
    }
    await sleep(PAUSE_MS);
  }
}

async function backfillCollections(): Promise<void> {
  const collections = await prisma.collection.findMany({
    where: { artworkUrl: null, sourceId: { not: null }, sourceProvider: { not: null } },
  });
  console.log(`\ncollections without artwork: ${collections.length}`);

  for (const collection of collections) {
    const provider = collection.sourceProvider!;
    const sourceId = collection.sourceId!;
    try {
      // Album or playlist is read from the stored source URL rather than
      // probed, for the same reason refreshCollection reads it: the two have
      // separate endpoints and a wrong guess is a 404, not a fallback.
      const ref = collection.sourceUrl
        ? provider === Provider.apple_music
          ? parseAppleMusicLink(collection.sourceUrl)
          : parseSpotifyLink(collection.sourceUrl)
        : null;
      const isPlaylist = ref?.kind === "playlist" || sourceId.startsWith("pl.");

      let art: Artwork | undefined;
      if (provider === Provider.spotify) {
        art = isPlaylist
          ? (await fetchPlaylist(sourceId))?.artwork
          : (await fetchAlbum(sourceId))?.artwork;
      } else if (!isPlaylist) {
        // Apple playlists need a developer token; albums do not.
        art = (await fetchAppleAlbum(sourceId))?.artwork;
      }

      report("collection", collection.name, art ?? null);
      if (APPLY && art?.url) {
        await prisma.collection.update({
          where: { id: collection.id },
          data: { artworkUrl: art.url, artworkThumbUrl: art.thumbUrl },
        });
      }
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  collection  ${collection.name.slice(0, 48)}  ${(error as Error).message}`);
    }
    await sleep(PAUSE_MS);
  }
}

async function main(): Promise<void> {
  console.log(APPLY ? "APPLYING artwork backfill" : "DRY RUN — pass --apply to write");

  await backfillAlbums();
  await backfillRecordings();
  await backfillCollections();

  console.log(
    `\n${APPLY ? "filled" : "would fill"}: ${filled}   no image available: ${missing}   failed: ${failed}`,
  );
  if (!APPLY && filled > 0) console.log("Re-run with --apply to write these.");

  await prisma.$disconnect();
  // A failed lookup is worth a non-zero exit so a scripted run notices.
  if (failed > 0) process.exitCode = 1;
}

/**
 * Called rather than top-level-awaited: `.ts` here resolves as CommonJS through
 * tsx, which has no top-level await. The rejection handler is what keeps a
 * failure from becoming an unhandled promise and a zero exit code.
 */
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
