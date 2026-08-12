import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Fetches a Clerk testing token before the suite runs.
 *
 * Without it, Clerk's bot protection challenges an automated browser and every
 * signed-in spec fails for a reason unrelated to the application. It needs only
 * the publishable key, and is a no-op for the anonymous specs.
 */
export default async function globalSetup() {
  await clerkSetup({ publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
}
