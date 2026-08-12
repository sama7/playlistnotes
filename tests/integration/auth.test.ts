import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveLocalUser } from "@/lib/auth";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveLocalUser", () => {
  it("creates a local user on first sight of a verified subject", async () => {
    const user = await resolveLocalUser("user_first_sight");

    expect(user.authSubject).toBe("user_first_sight");
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await prisma.user.count()).toBe(1);
  });

  it("returns the same row on subsequent requests", async () => {
    const first = await resolveLocalUser("user_repeat");
    const second = await resolveLocalUser("user_repeat");

    expect(second.id).toBe(first.id);
    expect(await prisma.user.count()).toBe(1);
  });

  /**
   * The invariant from AGENTS.md §9. Prisma's `upsert` is find-then-create and
   * loses this race; INSERT … ON CONFLICT delegates it to PostgreSQL's unique
   * index, which is the only place it can be settled atomically.
   */
  it("creates exactly one row when concurrent first requests race", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => resolveLocalUser("user_concurrent")),
    );

    const ids = new Set(results.map((u) => u.id));
    expect(ids.size).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it("keeps distinct subjects in distinct rows", async () => {
    const [a, b] = await Promise.all([
      resolveLocalUser("user_a"),
      resolveLocalUser("user_b"),
    ]);

    expect(a.id).not.toBe(b.id);
    expect(await prisma.user.count()).toBe(2);
  });

  /**
   * Account linking is delegated to the auth provider. TrackJot must never
   * merge two local accounts because two profiles happen to carry the same
   * email string — an unverified email is not an identity.
   */
  it("does not merge distinct subjects that share an email", async () => {
    const a = await resolveLocalUser("user_google_oauth");
    const b = await resolveLocalUser("user_email_otp");

    await prisma.user.update({
      where: { id: a.id },
      data: { displayName: "same.person@example.com" },
    });
    await prisma.user.update({
      where: { id: b.id },
      data: { displayName: "same.person@example.com" },
    });

    expect(a.id).not.toBe(b.id);
    expect(await prisma.user.count()).toBe(2);
  });

  it("does not overwrite profile fields on re-resolution", async () => {
    const created = await resolveLocalUser("user_profile");
    await prisma.user.update({
      where: { id: created.id },
      data: { username: "ada", displayName: "Ada" },
    });

    const again = await resolveLocalUser("user_profile");

    expect(again.username).toBe("ada");
    expect(again.displayName).toBe("Ada");
  });
});
