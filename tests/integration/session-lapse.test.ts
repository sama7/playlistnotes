import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { epochDay, recordSessionLapse, utcDateString } from "@/lib/session-lapse";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordSessionLapse", () => {
  it("records a returning visitor and the gap since their last session", async () => {
    await recordSessionLapse({ visitorId: "visitor-a", lastSeenDay: epochDay() - 8 });

    const rows = await prisma.authLapse.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.daysSinceLastSignIn).toBe(8);
    expect(rows[0]?.visitorId).toBe("visitor-a");
  });

  /** Refreshing the sign-in page must not inflate the number. */
  it("records once per browser per day however many times it is called", async () => {
    for (let i = 0; i < 5; i++) {
      await recordSessionLapse({ visitorId: "visitor-b", lastSeenDay: epochDay() - 9 });
    }

    expect(await prisma.authLapse.count()).toBe(1);
  });

  it("does not race into duplicates across concurrent tabs", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        recordSessionLapse({ visitorId: "visitor-c", lastSeenDay: epochDay() - 7 }),
      ),
    );

    expect(await prisma.authLapse.count()).toBe(1);
  });

  it("keeps separate visitors separate", async () => {
    await recordSessionLapse({ visitorId: "visitor-d", lastSeenDay: epochDay() - 7 });
    await recordSessionLapse({ visitorId: "visitor-e", lastSeenDay: epochDay() - 30 });

    expect(await prisma.authLapse.count()).toBe(2);
  });

  /** A same-day sign-out is not a lapse; a negative gap is a clock change or a
   *  forged cookie. Neither should become data. */
  it("ignores same-day and negative gaps", async () => {
    await recordSessionLapse({ visitorId: "visitor-f", lastSeenDay: epochDay() });
    await recordSessionLapse({ visitorId: "visitor-g", lastSeenDay: epochDay() + 5 });

    expect(await prisma.authLapse.count()).toBe(0);
  });

  /**
   * Regression: passing a Date meant PostgreSQL converted it into the session
   * timezone before casting to date, filing UTC midnight under the previous
   * day for any negative offset. Pinned to a fixed instant so it fails in every
   * timezone, not just west of UTC.
   */
  it("files the event under the UTC date, whatever the database timezone", async () => {
    const justAfterUtcMidnight = new Date("2026-03-05T00:30:00.000Z");

    await recordSessionLapse({
      visitorId: "visitor-tz",
      lastSeenDay: epochDay(justAfterUtcMidnight) - 11,
      now: justAfterUtcMidnight,
    });

    const row = await prisma.authLapse.findFirstOrThrow({ where: { visitorId: "visitor-tz" } });
    expect(utcDateString(row.occurredOn)).toBe("2026-03-05");
    expect(row.daysSinceLastSignIn).toBe(11);
  });

  it("stores no user identifier — the visitor is signed out and unknowable", async () => {
    await recordSessionLapse({ visitorId: "visitor-h", lastSeenDay: epochDay() - 10 });

    const row = await prisma.authLapse.findFirstOrThrow();
    expect(Object.keys(row)).toEqual(
      expect.not.arrayContaining(["userId", "ownerId", "email", "authSubject"]),
    );
  });
});
