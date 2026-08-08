import { describe, expect, it } from "vitest";
import { normalizedKey } from "./normalize";

describe("normalizedKey", () => {
  it("ignores case, punctuation, and spacing", () => {
    const a = normalizedKey({ title: "Signal Fade", artistDisplay: "Nova Vera" });
    const b = normalizedKey({ title: "signal   fade!", artistDisplay: "NOVA VERA" });
    expect(a).toBe(b);
  });

  it("folds diacritics so accented spellings agree", () => {
    expect(normalizedKey({ title: "Halo", artistDisplay: "Beyoncé" })).toBe(
      normalizedKey({ title: "Halo", artistDisplay: "Beyonce" }),
    );
  });

  it("strips trailing featured-artist suffixes", () => {
    expect(
      normalizedKey({ title: "Signal Fade (feat. Kestrel)", artistDisplay: "Nova Vera" }),
    ).toBe(normalizedKey({ title: "Signal Fade", artistDisplay: "Nova Vera" }));
  });

  it("buckets durations so encoding jitter still agrees", () => {
    expect(
      normalizedKey({ title: "A", artistDisplay: "B", durationMs: 214_000 }),
    ).toBe(normalizedKey({ title: "A", artistDisplay: "B", durationMs: 215_900 }));
  });

  it("separates materially different durations", () => {
    expect(
      normalizedKey({ title: "A", artistDisplay: "B", durationMs: 214_000 }),
    ).not.toBe(normalizedKey({ title: "A", artistDisplay: "B", durationMs: 402_000 }));
  });

  it("does not collapse different recordings by the same artist", () => {
    expect(normalizedKey({ title: "Signal Fade", artistDisplay: "Nova Vera" })).not.toBe(
      normalizedKey({ title: "Harbour Light", artistDisplay: "Nova Vera" }),
    );
  });

  it("treats a missing duration as its own bucket rather than guessing", () => {
    expect(normalizedKey({ title: "A", artistDisplay: "B" })).not.toBe(
      normalizedKey({ title: "A", artistDisplay: "B", durationMs: 200_000 }),
    );
  });
});
