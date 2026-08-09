import { cookies } from "next/headers";
import { SignIn } from "@clerk/nextjs";
import {
  LAST_SEEN_COOKIE,
  VISITOR_COOKIE,
  parseLastSeenDay,
  recordSessionLapse,
} from "@/lib/session-lapse";

export const dynamic = "force-dynamic";

/**
 * A returning visitor is one who arrives here carrying breadcrumb cookies from
 * a previous signed-in visit. Clerk appends `redirect_url` when it bounces
 * someone off a protected page, which separates "my session expired" from "I
 * clicked sign in deliberately".
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);

  const wasBounced = typeof params.redirect_url === "string";
  const visitorId = jar.get(VISITOR_COOKIE)?.value;
  const lastSeenDay = parseLastSeenDay(jar.get(LAST_SEEN_COOKIE)?.value);

  if (wasBounced && visitorId && lastSeenDay !== null) {
    await recordSessionLapse({ visitorId, lastSeenDay });
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "70vh" }}>
      <SignIn />
    </main>
  );
}
