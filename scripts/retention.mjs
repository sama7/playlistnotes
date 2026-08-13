#!/usr/bin/env node
/**
 * The retention report.
 *
 * This exists because "measured user retention" had been an intention rather
 * than a measurement: the database held every timestamp needed and nothing ever
 * asked it a question. Raw material is not evidence.
 *
 * ## What is actually being measured
 *
 * The claim worth substantiating is narrow and behavioural: **did someone come
 * back on a later day and write again.** Not visits, not sessions, not
 * pageviews — a second note on a second day is the only signal that the product
 * did its job, because the product's job is to be worth returning to.
 *
 * So the funnel is three steps, and each one can fail for a different reason:
 *
 *   signed up  →  wrote something  →  came back and wrote again
 *   (curiosity)   (activation)        (retention)
 *
 * A gap between the first two means the capture flow is too hard. A gap between
 * the last two means the product is not worth a second visit. Collapsing them
 * into one "active users" number would hide which of those is true.
 *
 * ## Reading it honestly at small numbers
 *
 * With a handful of users these are anecdotes with denominators, and the report
 * says so rather than printing a confident percentage of four people. The point
 * at this stage is direction and the shape of the drop-off, not statistics.
 *
 * Nothing here reads a note's text. Only counts and dates.
 *
 * Usage: node scripts/retention.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const pct = (n, d) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);
const pad = (s, n) => String(s).padEnd(n);

/** Small samples deserve a caveat, not a decimal place. */
function caveat(total) {
  if (total === 0) return "no users yet";
  if (total < 5) return "too few to mean anything — read as anecdote";
  if (total < 20) return "directional only";
  return null;
}

const [users, notes, collections, lapses] = await Promise.all([
  prisma.user.findMany({ select: { id: true, createdAt: true } }),
  prisma.note.findMany({ select: { ownerId: true, createdAt: true } }),
  prisma.collection.count(),
  prisma.authLapse.findMany({ select: { daysSinceLastSignIn: true, occurredOn: true } }),
]);

const day = (d) => d.toISOString().slice(0, 10);

/** ownerId -> sorted set of distinct UTC days on which they wrote. */
const writingDays = new Map();
for (const note of notes) {
  const set = writingDays.get(note.ownerId) ?? new Set();
  set.add(day(note.createdAt));
  writingDays.set(note.ownerId, set);
}

const activated = users.filter((u) => writingDays.has(u.id));
const returned = users.filter((u) => (writingDays.get(u.id)?.size ?? 0) >= 2);

console.log("\nTrackJot — retention\n");

const note = caveat(users.length);
if (note) console.log(`  ⚠ ${note}\n`);

console.log("  THE FUNNEL");
console.log(`    signed up                 ${pad(users.length, 6)}`);
console.log(
  `    wrote something           ${pad(activated.length, 6)} ${pct(activated.length, users.length)}  activation`,
);
console.log(
  `    came back and wrote again ${pad(returned.length, 6)} ${pct(returned.length, activated.length)}  of those who started`,
);

/**
 * Days between signing up and writing a second day's note. The interesting
 * number is not the average but whether it is ever more than one — a second
 * note on the same afternoon is enthusiasm, one a week later is a habit.
 */
const gaps = [];
for (const user of users) {
  const days = [...(writingDays.get(user.id) ?? [])].sort();
  if (days.length < 2) continue;
  const first = Date.parse(`${days[0]}T00:00:00Z`);
  const second = Date.parse(`${days[1]}T00:00:00Z`);
  gaps.push(Math.round((second - first) / 86_400_000));
}

if (gaps.length > 0) {
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  console.log(`\n  DAYS TO THE SECOND WRITING DAY`);
  console.log(`    median ${median}   range ${gaps[0]}–${gaps[gaps.length - 1]}`);
}

/** Weekly signup cohorts, so a good first week is not mistaken for a trend. */
const cohorts = new Map();
for (const user of users) {
  const d = new Date(user.createdAt);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const week = day(d);
  const c = cohorts.get(week) ?? { signed: 0, wrote: 0, returned: 0 };
  c.signed++;
  const days = writingDays.get(user.id)?.size ?? 0;
  if (days >= 1) c.wrote++;
  if (days >= 2) c.returned++;
  cohorts.set(week, c);
}

if (cohorts.size > 0) {
  console.log(`\n  BY SIGNUP WEEK`);
  console.log(`    ${pad("week of", 12)}${pad("signed", 8)}${pad("wrote", 8)}returned`);
  for (const [week, c] of [...cohorts].sort()) {
    console.log(`    ${pad(week, 12)}${pad(c.signed, 8)}${pad(c.wrote, 8)}${c.returned}`);
  }
}

/**
 * Forced sign-outs. This is the counter-metric: a lapse is the product losing
 * someone for a reason that has nothing to do with whether they liked it.
 * Clustering around seven days means Clerk's Hobby session cap is doing it, and
 * that is a billing decision masquerading as churn.
 */
console.log(`\n  FORCED SIGN-OUTS  (returning visitors who met a sign-in wall)`);
if (lapses.length === 0) {
  console.log(`    none recorded`);
} else {
  const around7 = lapses.filter((l) => l.daysSinceLastSignIn >= 6 && l.daysSinceLastSignIn <= 8);
  console.log(`    total ${lapses.length}`);
  console.log(
    `    at 6–8 days ${around7.length}` +
      (around7.length > 0 ? "  ← Clerk's 7-day Hobby cap, not disinterest" : ""),
  );
}

console.log(`\n  Corpus: ${notes.length} notes, ${collections} collections\n`);

await prisma.$disconnect();
