import { describe, expect, it } from "vitest";
import { dayBoundsInZone, formatExperienced } from "./format-date";

/**
 * A filter has to agree with the page it is filtering.
 *
 * The reported case: a listen displayed as "September 8, 11 p.m." in New York
 * was excluded by a September 8 filter, because the bounds were built by
 * pasting `T00:00:00Z` onto the date input's value. 11pm on the 8th in New York
 * is 03:00 on the 9th in UTC, so the row fell outside a window that claimed to
 * contain it.
 */
describe("calendar-day bounds", () => {
  it("includes an 11pm New York listen in a New York day filter", () => {
    const bounds = dayBoundsInZone("2026-09-08", "America/New_York")!;
    const elevenPmNewYork = new Date("2026-09-09T03:00:00Z");

    expect(elevenPmNewYork >= bounds.start && elevenPmNewYork <= bounds.end).toBe(true);
  });

  it("excludes that same instant from the previous day", () => {
    const bounds = dayBoundsInZone("2026-09-07", "America/New_York")!;
    const elevenPmNewYork = new Date("2026-09-09T03:00:00Z");

    expect(elevenPmNewYork <= bounds.end).toBe(false);
  });

  /** Two of the three days a year where a fixed offset gives the wrong answer. */
  it("is 23 hours long when the clocks go forward and 25 when they go back", () => {
    const spring = dayBoundsInZone("2026-03-08", "America/New_York")!;
    const autumn = dayBoundsInZone("2026-11-01", "America/New_York")!;

    const hours = (b: { start: Date; end: Date }) =>
      Math.round((b.end.getTime() - b.start.getTime()) / 3_600_000);

    expect(hours(spring)).toBe(23);
    expect(hours(autumn)).toBe(25);
  });

  it("follows a zone east of Greenwich too", () => {
    const bounds = dayBoundsInZone("2026-09-08", "Asia/Karachi")!;
    expect(bounds.start.toISOString()).toBe("2026-09-07T19:00:00.000Z");
  });

  it("refuses a value that is not a calendar day", () => {
    expect(dayBoundsInZone("", "UTC")).toBeNull();
    expect(dayBoundsInZone("not-a-day", "UTC")).toBeNull();
  });
});

/**
 * An approximate date is not an instant, and must not be re-read as one.
 *
 * A year-precision note is stored as the first instant of that year. Rendering
 * that anchor in a western zone would move it back to December 31st and change
 * the year the writer actually claimed — so only precisions that describe a
 * moment follow the reader's zone.
 */
describe("rendering a claimed precision", () => {
  const newYearUtc = new Date("2026-01-01T12:00:00Z");

  it("keeps the stated year whatever zone the reader is in", () => {
    for (const zone of ["America/Los_Angeles", "Asia/Karachi", "UTC"]) {
      expect(formatExperienced(newYearUtc, "year", zone)).toBe("2026");
    }
  });

  it("keeps the stated month whatever zone the reader is in", () => {
    for (const zone of ["America/Los_Angeles", "Asia/Karachi", "UTC"]) {
      expect(formatExperienced(newYearUtc, "month", zone)).toBe("January 2026");
    }
  });

  /** A scrobble knows the minute, and that one really is an instant. */
  it("moves a known instant into the reader's zone", () => {
    const evening = new Date("2026-09-09T03:00:00Z");
    expect(formatExperienced(evening, "time", "America/New_York")).toContain("Sep 8");
    expect(formatExperienced(evening, "time", "UTC")).toContain("Sep 9");
  });
});
