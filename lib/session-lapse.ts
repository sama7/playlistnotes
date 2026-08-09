import { prisma } from "@/lib/db";

/**
 * Detecting a returning visitor who lost their session.
 *
 * The problem: when a session expires the user is signed out, so the server has
 * no idea who they are — or whether they have ever been here before. A brand
 * new visitor and a three-week regular look identical at the sign-in page.
 *
 * The fix is a breadcrumb that OUTLIVES the session: two first-party cookies
 * written while the user is signed in, which survive Clerk's session expiring.
 * If someone arrives at sign-in carrying those cookies, they are returning.
 *
 * Neither cookie carries personal data. `pn_visitor` is a random identifier
 * with no link to an account; `pn_last_seen` is a day number. We could not
 * record a user ID here even if we wanted to — the visitor is signed out.
 */

export const VISITOR_COOKIE = "pn_visitor";
export const LAST_SEEN_COOKIE = "pn_last_seen";

/** Browsers cap persistent cookies at 400 days; ask for the maximum. */
export const BREADCRUMB_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Whole days since the Unix epoch. Compact, and coarse enough to be dull. */
export function epochDay(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 86_400_000);
}

/** `YYYY-MM-DD` in UTC, matching how `epochDay` buckets time. */
export function utcDateString(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Record that a returning visitor met a sign-in prompt.
 *
 * Idempotent per browser per day: refreshing the sign-in page five times is one
 * event, not five. Uses ON CONFLICT DO NOTHING rather than a read-then-write so
 * concurrent tabs cannot race into duplicates.
 *
 * Never throws into the request path — instrumentation must not be able to
 * break a sign-in page.
 */
export async function recordSessionLapse(input: {
  visitorId: string;
  lastSeenDay: number;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const days = epochDay(now) - input.lastSeenDay;

  // A negative gap means a clock change or a forged cookie; ignore rather than
  // storing nonsense. Zero days is a same-day sign-out, not a lapse.
  if (!Number.isFinite(days) || days <= 0) return;

  // Pass the day as a literal 'YYYY-MM-DD' string, NOT a Date. A Date is sent
  // as timestamptz and PostgreSQL converts it into the session timezone before
  // casting to date — so UTC midnight lands on the previous day for any
  // negative offset, and events near midnight get filed under the wrong date.
  const occurredOn = utcDateString(now);

  try {
    await prisma.$executeRaw`
      INSERT INTO auth_lapses (id, visitor_id, occurred_on, days_since_last_sign_in, created_at)
      VALUES (gen_random_uuid(), ${input.visitorId}, ${occurredOn}::date, ${days}, now())
      ON CONFLICT (visitor_id, occurred_on) DO NOTHING
    `;
  } catch (error) {
    console.error("Failed to record session lapse", error);
  }
}

/** Parse a cookie value that should be an epoch-day integer. */
export function parseLastSeenDay(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
