import { describe, expect, it } from "vitest";
import { shouldApply, shouldPoll } from "./polling";

/**
 * The rule that keeps a live-updating list from stealing someone's sentence.
 */
describe("when the strip may poll", () => {
  it("polls when nobody is writing and the tab is visible", () => {
    expect(shouldPoll({ writing: null, hidden: false, stopped: false })).toBe(true);
  });

  it("never polls while a jot box is open", () => {
    expect(shouldPoll({ writing: "1756400000:anyasa - rasiya", hidden: false, stopped: false })).toBe(
      false,
    );
  });

  it("never polls a tab nobody is looking at", () => {
    expect(shouldPoll({ writing: null, hidden: true, stopped: false })).toBe(false);
  });

  it("never polls after teardown", () => {
    expect(shouldPoll({ writing: null, hidden: false, stopped: true })).toBe(false);
  });
});

describe("when a reply may be shown", () => {
  it("shows a reply that arrives while nothing is being written", () => {
    expect(shouldApply({ writing: null, stopped: false })).toBe(true);
  });

  /**
   * The case the whole guard exists for: the request left before the click, and
   * the answer arrives after it. Applying it would shuffle the list under a
   * half-written sentence.
   */
  it("drops a reply that arrives after a jot box has opened", () => {
    expect(shouldApply({ writing: "1756400000:anyasa - rasiya", stopped: false })).toBe(false);
  });

  it("drops a reply that arrives after teardown", () => {
    expect(shouldApply({ writing: null, stopped: true })).toBe(false);
  });

  /**
   * Deliberately different from `shouldPoll`: a hidden tab does not *ask*, but
   * it may still show something it already asked for.
   */
  it("still shows a reply to a request made before the tab was hidden", () => {
    expect(shouldApply({ writing: null, stopped: false })).toBe(true);
  });
});
