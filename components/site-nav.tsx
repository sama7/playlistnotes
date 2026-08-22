import Link from "next/link";
import { SignedIn, SignedOut, SignOutButton } from "@clerk/nextjs";

/**
 * The header, on every page.
 *
 * Until now each page carried its own scattering of links — a bare "Sign in" in
 * the landing footer duplicating the buttons directly above it, and a signed-in
 * user landing on `/account` with no way back. Navigation belongs in one place
 * that every route inherits, so there is exactly one answer to "where am I and
 * how do I get home".
 *
 * `SignedIn` / `SignedOut` render on the server from the verified session, so
 * the header never flashes the wrong state on load and never decides anything
 * from a client-held value.
 */
export function SiteNav() {
  return (
    <header className="site-nav">
      <Link href="/" className="wordmark">
        TrackJot
      </Link>

      <nav aria-label="Main">
        <SignedIn>
          <Link href="/notes">Notes</Link>
          <Link href="/collections">Collections</Link>
          <Link href="/account">Account</Link>
          {/*
            Clerk's own button, unstyled by us and given no children.
            Passing a custom `<button>` child here threw
            "You've passed multiple children components to <SignOutButton/>" at
            render time and took down every signed-in page — the same failure a
            custom child caused on SignInButton. Clerk's control components want
            to own their trigger; the wrapper below is where the styling goes.
          */}
          <span className="nav-signout">
            <SignOutButton />
          </span>
        </SignedIn>

        <SignedOut>
          <Link href="/about">About</Link>
          {/*
            Plain links to the hosted pages rather than Clerk's modal buttons.
            The landing page opens the modal, which is right for a call to
            action; a header is navigation, and navigation should survive
            without JavaScript, be middle-clickable, and read as a link to a
            screen reader. It also keeps one accessible name per action on a
            page that already has the modal CTA in its hero.
          */}
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up" className="nav-cta">
            Create an account
          </Link>
        </SignedOut>
      </nav>
    </header>
  );
}
