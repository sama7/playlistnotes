#!/usr/bin/env node
/**
 * Assert that a Playwright suite actually ran, rather than skipping itself.
 *
 * ## Why this exists
 *
 * A suite whose every test is gated on an environment variable exits **0** when
 * that variable is missing — Playwright reports "5 skipped" and the step goes
 * green. That is not a hypothetical: for months every browser test for Last.fm
 * skipped on every build, because CI holds no credentials, and nobody noticed
 * that the feature was unverified precisely because the badge was green.
 *
 * Building a fixture so those tests *can* run does not fix that on its own. If
 * the fixture's environment variable is ever dropped from the workflow, the
 * suite goes back to skipping and CI goes back to lying — quietly, and in the
 * direction that looks like success.
 *
 * So the counts are asserted. Green now means the tests ran.
 *
 * Usage: node scripts/assert-suite-ran.mjs <results.json> <minimum passed>
 */

import { readFileSync } from "node:fs";

const [file, minimum = "1"] = process.argv.slice(2);
if (!file) {
  console.error("usage: assert-suite-ran.mjs <results.json> <minimum passed>");
  process.exit(2);
}

let stats;
try {
  stats = JSON.parse(readFileSync(file, "utf8")).stats ?? {};
} catch (error) {
  console.error(`Could not read Playwright results from ${file}: ${error.message}`);
  process.exit(2);
}

const passed = stats.expected ?? 0;
const skipped = stats.skipped ?? 0;
const failed = stats.unexpected ?? 0;
const floor = Number(minimum);

console.log(`suite: ${passed} passed, ${skipped} skipped, ${failed} failed`);

if (failed > 0) {
  console.error(`${failed} test(s) failed.`);
  process.exit(1);
}
if (skipped > 0) {
  console.error(
    `${skipped} test(s) skipped. This suite must actually run here — a skipped ` +
      `suite exits 0 and makes a green build meaningless.`,
  );
  process.exit(1);
}
if (passed < floor) {
  console.error(`Only ${passed} test(s) ran; expected at least ${floor}.`);
  process.exit(1);
}
