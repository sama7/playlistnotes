import Link from "next/link";

/**
 * The footer.
 *
 * Deliberately without a sign-in link. The landing page carried one, directly
 * beneath the two sign-in buttons in its own hero and now also beneath the pair
 * in the header — three ways to do the same thing on one screen, which reads as
 * an oversight rather than as helpfulness. Authentication lives in the header;
 * the footer is for the things that have nowhere else to go.
 */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <p className="note">
        <Link href="/about">About</Link> · TrackJot doesn&rsquo;t track you. It helps you
        keep track of what you chose to remember.
      </p>
    </footer>
  );
}
