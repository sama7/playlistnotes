import type { DatePrecision } from "@prisma/client";

/**
 * Dates, formatted identically on the server and in the browser.
 *
 * `toLocaleDateString()` with no options reads the runtime's own locale and
 * time zone, which differ between the Node process that renders and the browser
 * that hydrates — React then reports a hydration mismatch and swaps the text on
 * load. Pinning both makes them agree.
 *
 * **The zone is now the account's**, passed in. It was a single hardcoded
 * `America/New_York` for everybody, which was an improvement on UTC — a note
 * written at 9pm on the 17th in New York displayed as the 18th — but only for
 * people in New York. Every function here takes the zone explicitly rather than
 * reading a module-level global, because these run inside concurrent server
 * renders and a mutable global would let one reader's zone format another
 * reader's page.
 *
 * `DEFAULT_TIME_ZONE` remains the fallback for an account that has never chosen
 * one, deliberately rather than UTC: every note that already exists was written
 * when this was the only behaviour, and switching those to UTC would move the
 * times they display.
 */

export const DEFAULT_TIME_ZONE = "America/New_York";
/** @deprecated Use the account's zone; kept so existing imports still resolve. */
export const DISPLAY_TIME_ZONE = DEFAULT_TIME_ZONE;
const LOCALE = "en-US";

/** Formatters are cached per zone — building one per render is not free. */
const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${zone}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: zone });
    cache.set(key, found);
  }
  return found;
}

const DAY_OPTS = { month: "short", day: "numeric", year: "numeric" } as const;
const MONTH_OPTS = { month: "long", year: "numeric" } as const;
const YEAR_OPTS = { year: "numeric" } as const;
const INSTANT_OPTS = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
} as const;

/** "Aug 17, 2026" */
export function formatDay(value: Date | string, zone: string = DEFAULT_TIME_ZONE): string {
  return formatter(zone, DAY_OPTS).format(new Date(value));
}

/** "08/17/2026" — for dense contexts and for prefilling a date input. */
export function formatNumericDay(
  value: Date | string,
  zone: string = DEFAULT_TIME_ZONE,
): string {
  return formatter(zone, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * Render an "experienced at" date at the precision it was actually claimed.
 *
 * The column holds the first instant of the stated range, so a year-precision
 * note is stored as January 1st. Printing that as "Jan 1, 2011" would invent a
 * day the writer never said, which is why the precision travels with the date.
 *
 * `time` is the opposite case and arrives from listening history: the source
 * reported a specific minute, so showing only the day would discard precision
 * that was actually known.
 */
export function formatExperienced(
  value: Date | string | null,
  precision: DatePrecision | null,
  zone: string = DEFAULT_TIME_ZONE,
): string | null {
  if (!value || !precision) return null;
  const date = new Date(value);
  /**
   * `year` and `month` are **rendered in UTC**, and that is not an oversight.
   *
   * Those are approximate calendar dates, stored as the first instant of the
   * stated range — a year is the 1st of January at noon UTC. Rendering that
   * anchor in a western zone can push it back to December 31st and change the
   * year the writer actually claimed. An approximate date is not an instant and
   * must not be re-interpreted as one; only `time` and `day` describe something
   * that happened at a moment, and only those follow the reader's zone.
   */
  if (precision === "year") return formatter("UTC", YEAR_OPTS).format(date);
  if (precision === "month") return formatter("UTC", MONTH_OPTS).format(date);
  // A scrobble knows the minute. Rounding that to a day would throw away the
  // one thing a listening history is genuinely authoritative about.
  if (precision === "time") return formatter(zone, INSTANT_OPTS).format(date);
  return formatter("UTC", DAY_OPTS).format(date);
}

/**
 * "Written Aug 3, 2026 · edited Aug 14" — the second half only when it says
 * something new.
 *
 * Prisma's `@updatedAt` touches the row on every write, so `updatedAt` differs
 * from `createdAt` by milliseconds on a brand-new note. Comparing the formatted
 * days rather than the instants keeps "edited" meaning *edited*.
 */
export function describeTimestamps(
  createdAt: Date,
  updatedAt: Date,
  zone: string = DEFAULT_TIME_ZONE,
): string {
  const created = formatDay(createdAt, zone);
  const updated = formatDay(updatedAt, zone);
  return created === updated ? `Written ${created}` : `Written ${created} · edited ${updated}`;
}

/**
 * The value a `<input type="date">` needs: YYYY-MM-DD **in the display zone**.
 *
 * Slicing an ISO string would give the UTC day, which is the same off-by-one
 * bug in a different costume.
 */
export function toDateInputValue(
  value: Date | string,
  zone: string = DEFAULT_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: zone,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The instant a calendar day begins and ends **in a given zone**.
 *
 * This is the fix for a filter that disagreed with the page it was filtering. A
 * listen at 11pm on September 8th in New York is 03:00 on the 9th in UTC, and
 * the bounds were built by pasting `T00:00:00Z` onto the date input's value —
 * so "heard until the 8th" excluded a row the reader could see labelled the
 * 8th. Bounds have to be built in the same zone the label was rendered in.
 *
 * Implemented by asking Intl what offset the zone had at that moment rather
 * than by table lookup, so it stays correct across daylight-saving changes.
 */
export function dayBoundsInZone(
  day: string,
  zone: string = DEFAULT_TIME_ZONE,
): { start: Date; end: Date } | null {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return null;

  const offsetAt = (utcMs: number): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return asUtc - utcMs;
  };

  const resolve = (h: number, min: number, sec: number, ms: number): Date => {
    const naive = Date.UTC(y, m - 1, d, h, min, sec, ms);
    // Two passes: the first offset is read at the wrong instant on a DST
    // boundary, the second at one close enough for the offset to be right.
    let guess = naive - offsetAt(naive);
    guess = naive - offsetAt(guess);
    return new Date(guess);
  };

  return { start: resolve(0, 0, 0, 0), end: resolve(23, 59, 59, 999) };
}
