import { describe, expect, it } from "vitest";
import { parseCsv, headerIndex, CsvTooLargeError } from "./parse-csv";
import { CsvFormatError, parseExportifyCsv } from "./exportify";

/**
 * CSV is a file a stranger uploads, so these tests are as much about what the
 * parser refuses and survives as about what it reads.
 */

const HEADER =
  '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album URI","Album Name",' +
  '"Album Artist URI(s)","Album Artist Name(s)","Album Release Date","Track Number",' +
  '"Track Duration (ms)","ISRC"';

const TRACK = "spotify:track:4u43I0LP2Xf85OAS85eG0R";
const PND = "spotify:artist:2HPaUgqeutzr3jx5a9WyDd";
const DRAKE = "spotify:artist:3TVXtAsR1Inumwj472S9r4";
const ALBUM = "spotify:album:6Rl6YoCarF2GHPSQmmFjuR";

function row(fields: string[]): string {
  return fields.map((f) => `"${f.replace(/"/g, '""')}"`).join(",");
}

describe("the CSV reader", () => {
  it("handles quoted fields containing commas and newlines", () => {
    const rows = parseCsv('a,b\n"one, two","line\nbreak"\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["one, two", "line\nbreak"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  /** Left in place it corrupts the first header name, which then looks like a
   *  missing column rather than an encoding problem. */
  it("strips a UTF-8 BOM", () => {
    const rows = parseCsv("﻿Track URI,Track Name\nx,y");
    expect(rows[0]![0]).toBe("Track URI");
  });

  it("handles CRLF and a trailing newline without inventing a row", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a lone quote inside an unquoted field", () => {
    // Real exports contain things like `5" single`. Rejecting the file over it
    // would be the wrong trade for an import tool.
    expect(parseCsv('a\n5" single')).toEqual([["a"], ['5" single']]);
  });

  it("refuses a file with too many rows rather than allocating", () => {
    const big = "a\n" + "x\n".repeat(50);
    expect(() => parseCsv(big, { maxRows: 10 })).toThrow(CsvTooLargeError);
  });

  it("indexes headers case- and whitespace-insensitively", () => {
    const index = headerIndex(["Track  URI", "track name"]);
    expect(index.get("track uri")).toBe(0);
    expect(index.get("track name")).toBe(1);
  });
});

describe("reading an Exportify export", () => {
  it("builds artists from URI columns, never by splitting names", () => {
    const csv = [
      HEADER,
      row([
        TRACK,
        "CN TOWER",
        `${PND}, ${DRAKE}`,
        "PARTYNEXTDOOR, Drake",
        ALBUM,
        "$OME $EXY $ONGS 4 U",
        `${PND}, ${DRAKE}`,
        "PARTYNEXTDOOR, Drake",
        "2025-02-14",
        "4",
        "189000",
        "USUG12403756",
      ]),
    ].join("\n");

    const { tracks } = parseExportifyCsv(csv);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.artists).toEqual([
      { providerId: "2HPaUgqeutzr3jx5a9WyDd", name: "PARTYNEXTDOOR" },
      { providerId: "3TVXtAsR1Inumwj472S9r4", name: "Drake" },
    ]);
    expect(tracks[0]!.isrc).toBe("USUG12403756");
    expect(tracks[0]!.durationMs).toBe(189_000);
    expect(tracks[0]!.album?.providerId).toBe("6Rl6YoCarF2GHPSQmmFjuR");
  });

  /**
   * The case that makes name-splitting indefensible: one artist whose name
   * contains a comma. The single URI is what proves it is one artist, and no
   * amount of string cleverness could.
   */
  it("keeps a comma inside a single artist's name", () => {
    const csv = [
      HEADER,
      row([
        "spotify:track:0VaeksJaXy5R1nvcTMh3Xk",
        "Darling, I",
        "spotify:artist:4V8LLVI7PbaPR0K2TGSxFF",
        "Tyler, The Creator",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]),
    ].join("\n");

    const { tracks } = parseExportifyCsv(csv);
    expect(tracks[0]!.artists).toEqual([
      { providerId: "4V8LLVI7PbaPR0K2TGSxFF", name: "Tyler, The Creator" },
    ]);
    expect(tracks[0]!.name).toBe("Darling, I");
  });

  it("refuses names it cannot align, rather than attaching the wrong one", () => {
    const csv = [
      HEADER,
      row([TRACK, "CN TOWER", `${PND}, ${DRAKE}`, "Only One Name", "", "", "", "", "", "", "", ""]),
    ].join("\n");

    const { tracks } = parseExportifyCsv(csv);
    // Both entities still created from their IDs; names withheld rather than
    // guessed. A wrong name is cosmetic; a wrong entity is not.
    expect(tracks[0]!.artists.map((a) => a.providerId)).toEqual([
      "2HPaUgqeutzr3jx5a9WyDd",
      "3TVXtAsR1Inumwj472S9r4",
    ]);
    expect(tracks[0]!.artists.every((a) => a.name === "Unknown artist")).toBe(true);
    // The display credit is still exactly what was exported.
    expect(tracks[0]!.artistDisplay).toBe("Only One Name");
  });

  it("preserves order and duplicates", () => {
    const line = (id: string, name: string) =>
      row([`spotify:track:${id}`, name, PND, "PARTYNEXTDOOR", "", "", "", "", "", "", "", ""]);
    const csv = [
      HEADER,
      line("4u43I0LP2Xf85OAS85eG0R", "One"),
      line("1Az1QoedRFrbaxRKKPuJ2X", "Two"),
      line("4u43I0LP2Xf85OAS85eG0R", "One"),
    ].join("\n");

    const { tracks } = parseExportifyCsv(csv);
    expect(tracks.map((t) => t.name)).toEqual(["One", "Two", "One"]);
  });

  it("skips local files and episodes without failing the import", () => {
    const csv = [
      HEADER,
      row([TRACK, "CN TOWER", PND, "PARTYNEXTDOOR", "", "", "", "", "", "", "", ""]),
      row(["spotify:local:::Some Bootleg:214", "A Bootleg", "", "", "", "", "", "", "", "", "", ""]),
      row(["", "No URI at all", "", "", "", "", "", "", "", "", "", ""]),
    ].join("\n");

    const { tracks, skipped, failed } = parseExportifyCsv(csv);
    expect(tracks).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    expect(failed).toHaveLength(0);
    // Line numbers match what a spreadsheet shows, header included.
    expect(skipped[0]!.line).toBe(3);
  });

  it("reports a row with a URI but no name as failed, not skipped", () => {
    const csv = [HEADER, row([TRACK, "", PND, "PARTYNEXTDOOR", "", "", "", "", "", "", "", ""])].join(
      "\n",
    );
    const { tracks, failed } = parseExportifyCsv(csv);
    expect(tracks).toHaveLength(0);
    expect(failed).toEqual([{ line: 2, reason: "no track name" }]);
  });

  it("accepts open.spotify.com URLs and bare ids as well as URIs", () => {
    const csv = [
      HEADER,
      row([
        "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R?si=abc",
        "From a URL",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]),
      row(["1Az1QoedRFrbaxRKKPuJ2X", "Bare id", "", "", "", "", "", "", "", "", "", ""]),
    ].join("\n");

    const { tracks } = parseExportifyCsv(csv);
    expect(tracks.map((t) => t.providerId)).toEqual([
      "4u43I0LP2Xf85OAS85eG0R",
      "1Az1QoedRFrbaxRKKPuJ2X",
    ]);
  });

  it("tolerates alternative header spellings", () => {
    const csv = [
      '"Spotify Track URI","Title","Artist URIs","Artists"',
      row([TRACK, "CN TOWER", PND, "PARTYNEXTDOOR"]),
    ].join("\n");

    const { tracks } = parseExportifyCsv(csv);
    expect(tracks[0]!.name).toBe("CN TOWER");
    expect(tracks[0]!.artists[0]!.providerId).toBe("2HPaUgqeutzr3jx5a9WyDd");
  });

  it("explains a file with no track URI column instead of importing nothing", () => {
    const csv = ['"Song","Artist"', row(["CN TOWER", "PARTYNEXTDOOR"])].join("\n");
    expect(() => parseExportifyCsv(csv)).toThrow(CsvFormatError);
    expect(() => parseExportifyCsv(csv)).toThrow(/Track URI/i);
  });

  it("ignores blank padding rows", () => {
    const csv = [
      HEADER,
      row([TRACK, "CN TOWER", PND, "PARTYNEXTDOOR", "", "", "", "", "", "", "", ""]),
      ",,,,,,,,,,,",
      "",
    ].join("\n");

    const { tracks, skipped, failed } = parseExportifyCsv(csv);
    expect(tracks).toHaveLength(1);
    expect(skipped).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });
});
