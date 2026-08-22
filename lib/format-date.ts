import type { DatePrecision } from "@prisma/client";

/**
 * Dates, formatted identically on the server and in the browser.
 *
 * `toLocaleDateString()` with no options reads the runtime's own locale and
 * time zone, which differ between the Node process that renders and the browser
 * that hydrates — React then reports a hydration mismatch and swaps the text on
 * load. Pinning both makes them agree.
 *
 * **US format, US Eastern.** This was UTC, which is defensible for a column and
 * indefensible for a reader: a note written at 9pm on the 17th in New York
 * displayed as the 18th, so the product disagreed with the person using it
 * about what day it was. One fixed zone is still a placeholder — the right
 * answer is a per-account time zone, and that is what the account settings owe
 * users before launch. Until then, be wrong for nobody in the room rather than
 * wrong for everybody.
 */

export const DISPLAY_TIME_ZONE = "America/New_York";
const LOCALE = "en-US";

const DAY = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const MONTH = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const YEAR = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

/** "Aug 17, 2026" */
export function formatDay(value: Date | string): string {
  return DAY.format(new Date(value));
}

/** "08/17/2026" — for dense contexts and for prefilling a date input. */
export function formatNumericDay(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

/**
 * Render an "experienced at" date at the precision it was actually claimed.
 *
 * The column holds the first instant of the stated range, so a year-precision
 * note is stored as January 1st. Printing that as "Jan 1, 2011" would invent a
 * day the writer never said, which is why the precision travels with the date.
 */
export function formatExperienced(
  value: Date | string | null,
  precision: DatePrecision | null,
): string | null {
  if (!value || !precision) return null;
  const date = new Date(value);
  if (precision === "year") return YEAR.format(date);
  if (precision === "month") return MONTH.format(date);
  return DAY.format(date);
}

/**
 * "Written Aug 3, 2026 · edited Aug 14" — the second half only when it says
 * something new.
 *
 * Prisma's `@updatedAt` touches the row on every write, so `updatedAt` differs
 * from `createdAt` by milliseconds on a brand-new note. Comparing the formatted
 * days rather than the instants keeps "edited" meaning *edited*.
 */
export function describeTimestamps(createdAt: Date, updatedAt: Date): string {
  const created = formatDay(createdAt);
  const updated = formatDay(updatedAt);
  return created === updated ? `Written ${created}` : `Written ${created} · edited ${updated}`;
}

/**
 * The value a `<input type="date">` needs: YYYY-MM-DD **in the display zone**.
 *
 * Slicing an ISO string would give the UTC day, which is the same off-by-one
 * bug in a different costume.
 */
export function toDateInputValue(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
