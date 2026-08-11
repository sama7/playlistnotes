import { Provider } from "@prisma/client";
import type { ImportableArtist, ImportableCollection, ImportableTrack } from "../importable";
import { headerIndex, parseCsv, type CsvParseOptions } from "./parse-csv";

/**
 * Reading an Exportify-compatible CSV into the provider-neutral import shape.
 *
 * **Format compatibility only.** Exportify is never called, invoked, or
 * scraped; this reads a file the user exported themselves. It matters because
 * the two things link import genuinely cannot reach are private playlists and
 * Spotify's own editorial playlists, and a CSV is the honest way in for both.
 *
 * The rule that shapes everything here is the catalog policy: **entities come
 * from identifiers, never from names.** Exportify emits URI columns —
 * `Artist URI(s)`, `Album URI`, `Album Artist URI(s)` — and those split on
 * commas unambiguously, because a Spotify URI contains no comma. The parallel
 * name columns do not: "Tyler, The Creator" is one artist containing a comma
 * and there is no way to tell from the string alone. So artists and albums are
 * built from the URI columns and the name columns are used only to label the
 * rows those URIs created, positionally.
 *
 * When a row has one URI, the entire name field is that artist's name, comma or
 * not. When it has several, names are taken by position and a mismatch in
 * length means the names are abandoned rather than guessed at — a wrong name is
 * cosmetic, a wrong entity is not.
 */

export interface CsvRowError {
  /** 1-based, counting the header, so it matches what a spreadsheet shows. */
  line: number;
  reason: string;
}

export interface CsvParseResult {
  tracks: ImportableTrack[];
  /** Rows that were understood but deliberately not imported. */
  skipped: CsvRowError[];
  /** Rows that could not be read at all. */
  failed: CsvRowError[];
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

/** Canonical column names, plus the aliases seen in the wild. */
const COLUMNS = {
  trackUri: ["track uri", "spotify track uri", "uri", "track id"],
  trackName: ["track name", "name", "title"],
  artistUris: ["artist uri(s)", "artist uris", "artist uri"],
  artistNames: ["artist name(s)", "artist names", "artist name", "artist", "artists"],
  albumUri: ["album uri", "album id"],
  albumName: ["album name", "album"],
  albumArtistUris: ["album artist uri(s)", "album artist uris", "album artist uri"],
  albumArtistNames: ["album artist name(s)", "album artist names", "album artist"],
  releaseDate: ["album release date", "release date"],
  trackNumber: ["track number", "track #", "#"],
  durationMs: ["track duration (ms)", "duration (ms)", "duration ms", "duration"],
  isrc: ["isrc"],
} as const;

function findColumn(index: Map<string, number>, names: readonly string[]): number | null {
  for (const name of names) {
    const at = index.get(name);
    if (at !== undefined) return at;
  }
  return null;
}

/** `spotify:track:ID`, a full URL, or a bare ID. Returns the id or null. */
function extractId(raw: string, kind: "track" | "artist" | "album"): string | null {
  const value = raw.trim();
  if (!value) return null;

  const uri = new RegExp(`^spotify:${kind}:([A-Za-z0-9]{22})$`).exec(value);
  if (uri) return uri[1]!;

  const url = new RegExp(`^https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?${kind}/([A-Za-z0-9]{22})`).exec(
    value,
  );
  if (url) return url[1]!;

  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  return null;
}

/**
 * Pair a URI list with a name list.
 *
 * URIs are authoritative and split on commas safely. Names are attached only
 * when the counts agree — or when there is exactly one URI, in which case the
 * whole name field belongs to it however many commas it contains.
 */
function pairArtists(uriField: string, nameField: string, kind: "artist"): ImportableArtist[] {
  const ids = uriField
    .split(",")
    .map((part) => extractId(part, kind))
    .filter((id): id is string => id !== null);

  if (ids.length === 0) return [];

  if (ids.length === 1) {
    // "Tyler, The Creator" is one artist with a comma in the name. The single
    // URI is what proves it, and is exactly why names are never split first.
    return [{ providerId: ids[0]!, name: nameField.trim() || "Unknown artist" }];
  }

  const names = nameField.split(",").map((n) => n.trim());
  return ids.map((providerId, i) => ({
    providerId,
    // A length mismatch means the name list cannot be aligned; a placeholder is
    // better than confidently attaching the wrong name to the right entity.
    name: names.length === ids.length ? (names[i] || "Unknown artist") : "Unknown artist",
  }));
}

function toInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseExportifyCsv(
  text: string,
  options: CsvParseOptions = {},
): CsvParseResult {
  const rows = parseCsv(text, options);
  if (rows.length === 0) throw new CsvFormatError("That file is empty.");

  const index = headerIndex(rows[0]!);
  const at = {
    trackUri: findColumn(index, COLUMNS.trackUri),
    trackName: findColumn(index, COLUMNS.trackName),
    artistUris: findColumn(index, COLUMNS.artistUris),
    artistNames: findColumn(index, COLUMNS.artistNames),
    albumUri: findColumn(index, COLUMNS.albumUri),
    albumName: findColumn(index, COLUMNS.albumName),
    albumArtistUris: findColumn(index, COLUMNS.albumArtistUris),
    albumArtistNames: findColumn(index, COLUMNS.albumArtistNames),
    releaseDate: findColumn(index, COLUMNS.releaseDate),
    trackNumber: findColumn(index, COLUMNS.trackNumber),
    durationMs: findColumn(index, COLUMNS.durationMs),
    isrc: findColumn(index, COLUMNS.isrc),
  };

  if (at.trackUri === null) {
    throw new CsvFormatError(
      "That file has no Track URI column, so there is no reliable way to identify the tracks. " +
        "An Exportify export includes one.",
    );
  }

  const tracks: ImportableTrack[] = [];
  const skipped: CsvRowError[] = [];
  const failed: CsvRowError[] = [];

  const cell = (row: string[], column: number | null): string =>
    column === null ? "" : (row[column] ?? "");

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const line = r + 1;

    // A row of empty strings is padding, not a failure worth reporting.
    if (row.every((c) => c.trim() === "")) continue;

    const trackId = extractId(cell(row, at.trackUri), "track");
    if (!trackId) {
      const raw = cell(row, at.trackUri).trim();
      // Local files and podcast episodes have no track URI. They are a normal
      // part of a real export, so they are reported as skipped, not failed.
      skipped.push({
        line,
        reason: raw === "" ? "no track URI" : `not a Spotify track URI (${raw.slice(0, 40)})`,
      });
      continue;
    }

    const name = cell(row, at.trackName).trim();
    if (!name) {
      failed.push({ line, reason: "no track name" });
      continue;
    }

    const artists = pairArtists(cell(row, at.artistUris), cell(row, at.artistNames), "artist");
    const albumId = extractId(cell(row, at.albumUri), "album");
    const albumName = cell(row, at.albumName).trim();

    tracks.push({
      providerId: trackId,
      name,
      // The credit exactly as exported, never rebuilt from the entities — so a
      // row whose URIs we could not read still displays correctly.
      artistDisplay: cell(row, at.artistNames).trim() || "Unknown artist",
      artists,
      durationMs: toInt(cell(row, at.durationMs)),
      isrc: cell(row, at.isrc).trim() || null,
      trackNumber: toInt(cell(row, at.trackNumber)),
      album:
        albumId && albumName
          ? {
              providerId: albumId,
              name: albumName,
              artists: pairArtists(
                cell(row, at.albumArtistUris),
                cell(row, at.albumArtistNames),
                "artist",
              ),
              releaseDate: cell(row, at.releaseDate).trim() || null,
            }
          : null,
    });
  }

  return { tracks, skipped, failed };
}

export function toImportableCollection(
  name: string,
  result: CsvParseResult,
): ImportableCollection {
  return {
    provider: Provider.spotify,
    // A CSV is not addressable, so there is no provider id for the collection
    // itself — only for the tracks inside it.
    providerId: "",
    kind: "playlist",
    name,
    description: null,
    sourceUrl: "",
    tracks: result.tracks,
    truncated: false,
  };
}
