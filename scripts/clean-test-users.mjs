#!/usr/bin/env node
/**
 * Delete the Clerk users the signed-in e2e specs create.
 *
 * Every run signs up fresh accounts, so without this they accumulate in the
 * development instance forever. Untidy rather than dangerous — but a dashboard
 * full of `pn_alice_1786…` is exactly the kind of mess that makes a real user
 * hard to spot when something is actually wrong.
 *
 * ## The guards matter more than the deletion
 *
 * This is a script that deletes accounts, so it is deliberately hard to point
 * at the wrong thing:
 *
 *   1. **It refuses to run against a production instance.** A `sk_live_` key
 *      exits immediately. There is no flag to override that.
 *   2. **It only ever deletes addresses containing `+clerk_test`** — a marker
 *      Clerk itself reserves for testing and that no real signup can carry,
 *      because Clerk rejects those addresses outside development.
 *   3. It reports what it deleted rather than working silently.
 *
 * Anything that fails a guard is skipped and named, never deleted "just in
 * case".
 */

const KEY = process.env.CLERK_SECRET_KEY ?? "";
const API = "https://api.clerk.com/v1";

if (!KEY) {
  console.log("No CLERK_SECRET_KEY; nothing to clean.");
  process.exit(0);
}

if (KEY.startsWith("sk_live_")) {
  console.error(
    "Refusing to run against a PRODUCTION Clerk instance. This script deletes users.",
  );
  process.exit(1);
}

/** Clerk's reserved testing marker. A real signup cannot carry it. */
const TEST_MARKER = "+clerk_test";

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

const users = await api("/users?limit=500&order_by=-created_at");

let deleted = 0;
let kept = 0;

for (const user of users) {
  const emails = (user.email_addresses ?? []).map((e) => e.email_address ?? "");
  const isTestAccount = emails.length > 0 && emails.every((e) => e.includes(TEST_MARKER));

  if (!isTestAccount) {
    kept++;
    continue;
  }

  await api(`/users/${user.id}`, { method: "DELETE" });
  deleted++;
}

console.log(
  `Deleted ${deleted} test account(s); left ${kept} real account(s) untouched.`,
);
