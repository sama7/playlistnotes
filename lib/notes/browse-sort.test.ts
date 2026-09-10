import { describe, expect, it } from "vitest";
import { SORT_OPTIONS, defaultDirectionFor, directionOptions, isSortKey } from "./browse";

/**
 * The direction control describes the field it is sorting.
 *
 * It used to offer "A → Z / oldest first" and "Z → A / newest first" whatever
 * the sort was, so choosing "Recently written" left an alphabetical label
 * sitting beside a chronological ordering and the reader had to work out which
 * half of it applied to them. Half of it never did.
 */
describe("sort direction wording", () => {
  it("talks about time for a sort by time", () => {
    for (const sort of ["recent", "experienced"] as const) {
      expect(directionOptions(sort).map((o) => o.label)).toEqual([
        "Newest first",
        "Oldest first",
      ]);
    }
  });

  it("talks about letters for a sort by name", () => {
    for (const sort of ["track", "artist", "album"] as const) {
      expect(directionOptions(sort).map((o) => o.label)).toEqual(["Z → A", "A → Z"]);
    }
  });

  it("never mixes the two vocabularies in one control", () => {
    for (const option of SORT_OPTIONS) {
      const labels = directionOptions(option.value).join(" ");
      const alphabetical = labels.includes("→");
      const chronological = /first/.test(labels) && /Newest|Oldest/.test(labels);
      expect(alphabetical && chronological).toBe(false);
    }
  });

  /** Picking a field is enough; nobody sets two controls to express one intent. */
  it("runs each field the way that field is naturally read", () => {
    expect(defaultDirectionFor("recent")).toBe("desc");
    expect(defaultDirectionFor("experienced")).toBe("desc");
    expect(defaultDirectionFor("track")).toBe("asc");
    expect(defaultDirectionFor("artist")).toBe("asc");
    expect(defaultDirectionFor("album")).toBe("asc");
  });

  it("has a direction option for every sort on the allowlist", () => {
    for (const option of SORT_OPTIONS) {
      expect(isSortKey(option.value)).toBe(true);
      const options = directionOptions(option.value);
      expect(options).toHaveLength(2);
      expect(options.map((o) => o.value).sort()).toEqual(["asc", "desc"]);
      // The default has to be one of the two on offer.
      expect(options.some((o) => o.value === defaultDirectionFor(option.value))).toBe(true);
    }
  });
});
