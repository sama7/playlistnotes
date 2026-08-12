import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  INVITE_COOKIE,
  INVITE_MAX_AGE_SECONDS,
  inviteCookieValue,
  inviteGateEnabled,
  isValidInviteCode,
} from "@/lib/invite";

export const dynamic = "force-dynamic";

/** Never indexed, and never listed anywhere. */
export const metadata: Metadata = {
  title: "TrackJot — invite",
  robots: { index: false, follow: false },
};

/**
 * The invite gate.
 *
 * A Server Action rather than a route handler, so the code is submitted in a
 * POST body and never lands in a URL, a browser history entry, a referrer
 * header, or an access log.
 *
 * The wording avoids implying more security than exists. This keeps passers-by
 * out while the product is unfinished; it is not what protects anybody's notes.
 * That is owner-scoped queries, and it is unaffected by whoever gets past here.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // With the gate off, this page has no reason to exist.
  if (!inviteGateEnabled()) redirect("/");

  async function submit(formData: FormData) {
    "use server";

    const code = String(formData.get("code") ?? "");
    const target = String(formData.get("next") ?? "/");

    if (!isValidInviteCode(code)) {
      redirect(`/invite?error=1&next=${encodeURIComponent(target)}`);
    }

    (await cookies()).set(INVITE_COOKIE, await inviteCookieValue(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: INVITE_MAX_AGE_SECONDS,
    });

    /**
     * Only ever redirect to a path on this site. Echoing an attacker-supplied
     * absolute URL back into a redirect is an open-redirect, which is worth
     * closing even on a page like this — it is exactly the sort of endpoint
     * that gets reused later for something that matters.
     */
    const safe = target.startsWith("/") && !target.startsWith("//") ? target : "/";
    redirect(safe);
  }

  return (
    <main>
      <p className="eyebrow">TrackJot</p>
      <h1>This is a private preview.</h1>
      <p className="lede">
        TrackJot isn&rsquo;t open yet. If someone gave you a code, put it in below.
      </p>

      <form action={submit} className="capture" style={{ maxWidth: "24rem" }}>
        <input type="hidden" name="next" value={next ?? "/"} />
        <div className="field">
          <label htmlFor="code">Invite code</label>
          <input id="code" name="code" autoComplete="off" autoFocus required />
        </div>

        {error && (
          <p role="alert" className="error">
            That code isn&rsquo;t right.
          </p>
        )}

        <button type="submit">Continue</button>
      </form>

      <p className="note" style={{ marginTop: "2rem" }}>
        Nothing here is public yet, and nothing you write later will be either — notes
        start private and stay that way until you share them deliberately.
      </p>
    </main>
  );
}
