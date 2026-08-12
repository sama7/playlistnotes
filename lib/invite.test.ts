import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasValidInviteCookie,
  inviteCookieValue,
  inviteGateEnabled,
  inviteGateMisconfigured,
  isValidInviteCode,
} from "./invite";

/**
 * The invite gate.
 *
 * Worth being precise about what these tests are asserting, because the gate is
 * deliberately not a security boundary: a shared code held by ten testers is not
 * a secret, and nobody's notes depend on it — those are owner-scoped in the
 * query regardless of who gets through here.
 *
 * What the tests do protect is the two ways a doormat like this fails badly:
 * silently letting everyone through because of a configuration mistake, and
 * storing the code itself in a cookie where a rotation cannot revoke it.
 */

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["REQUIRE_INVITE_CODE", "INVITE_CODE", "CLERK_SECRET_KEY"]) {
    saved[key] = process.env[key];
  }
  process.env.CLERK_SECRET_KEY = "sk_test_fixture";
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("whether the gate is on", () => {
  it("is off when not requested", () => {
    delete process.env.REQUIRE_INVITE_CODE;
    process.env.INVITE_CODE = "letmein";
    expect(inviteGateEnabled()).toBe(false);
  });

  /**
   * The dangerous configuration: requested but with no code set. It must not
   * quietly behave as if it were on, because "the gate is enabled" would then
   * be an untrue statement in exactly the place someone would trust it.
   */
  it("is off — and reports itself misconfigured — when requested with no code", () => {
    process.env.REQUIRE_INVITE_CODE = "true";
    process.env.INVITE_CODE = "";
    expect(inviteGateEnabled()).toBe(false);
    expect(inviteGateMisconfigured()).toBe(true);
  });

  it("treats whitespace as no code at all", () => {
    process.env.REQUIRE_INVITE_CODE = "true";
    process.env.INVITE_CODE = "   ";
    expect(inviteGateEnabled()).toBe(false);
    expect(inviteGateMisconfigured()).toBe(true);
  });

  it("is on when both are set", () => {
    process.env.REQUIRE_INVITE_CODE = "true";
    process.env.INVITE_CODE = "letmein";
    expect(inviteGateEnabled()).toBe(true);
    expect(inviteGateMisconfigured()).toBe(false);
  });
});

describe("checking a submitted code", () => {
  beforeEach(() => {
    process.env.REQUIRE_INVITE_CODE = "true";
    process.env.INVITE_CODE = "open-sesame";
  });

  it("accepts the code, ignoring surrounding whitespace", () => {
    expect(isValidInviteCode("open-sesame")).toBe(true);
    expect(isValidInviteCode("  open-sesame  ")).toBe(true);
  });

  it("rejects anything else, including a prefix", () => {
    expect(isValidInviteCode("open")).toBe(false);
    expect(isValidInviteCode("open-sesame-extra")).toBe(false);
    expect(isValidInviteCode("Open-Sesame")).toBe(false);
    expect(isValidInviteCode("")).toBe(false);
  });

  it("rejects everything when no code is configured", () => {
    process.env.INVITE_CODE = "";
    expect(isValidInviteCode("")).toBe(false);
    expect(isValidInviteCode("anything")).toBe(false);
  });
});

describe("the cookie", () => {
  beforeEach(() => {
    process.env.REQUIRE_INVITE_CODE = "true";
    process.env.INVITE_CODE = "open-sesame";
  });

  /** If the cookie were the code, anyone reading a cookie jar could pass it on. */
  it("never contains the code itself", async () => {
    const value = await inviteCookieValue();
    expect(value).not.toContain("open-sesame");
    expect(value.length).toBe(32);
  });

  it("accepts the value it issues", async () => {
    expect(await hasValidInviteCookie(await inviteCookieValue())).toBe(true);
  });

  it("rejects an absent, empty, or forged value", async () => {
    expect(await hasValidInviteCookie(undefined)).toBe(false);
    expect(await hasValidInviteCookie("")).toBe(false);
    expect(await hasValidInviteCookie("x".repeat(32))).toBe(false);
  });

  /**
   * The property that makes rotation meaningful: changing the code must
   * invalidate cookies already handed out. A cookie that survived rotation
   * would make the code unrevocable.
   */
  it("stops accepting an old cookie once the code is rotated", async () => {
    const before = await inviteCookieValue();
    process.env.INVITE_CODE = "a-different-code";
    expect(await hasValidInviteCookie(before)).toBe(false);
    expect(await hasValidInviteCookie(await inviteCookieValue())).toBe(true);
  });
});
