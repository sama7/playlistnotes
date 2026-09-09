"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { unlinkLastfmAction } from "@/app/listens/actions";

/**
 * Connect or disconnect a Last.fm account.
 *
 * Connecting is a **link, not a form**: it navigates to Last.fm, where the user
 * approves on Last.fm's own site and comes back. Nothing is typed here, which
 * is why the connected name cannot be somebody else's profile.
 *
 * The copy keeps one distinction straight, because it is the basis on which
 * this is allowed to exist at all: TrackJot authenticates *to* Last.fm to read
 * a feed the user owns. Last.fm never authenticates anyone *into* TrackJot.
 */
export function LastfmForm({
  current,
  authAvailable,
  outcome,
}: {
  current: string | null;
  /** False when the shared secret is missing, so approval cannot be completed. */
  authAvailable: boolean;
  /** What just happened, if the user has come back from Last.fm. */
  outcome?: string;
}) {
  return (
    <div className="capture">
      {outcome === "connected" && (
        <p role="status" className="success">
          Connected. Your recent plays are on your notes page.
        </p>
      )}
      {outcome === "state" && (
        <p role="alert" className="error">
          That connection attempt didn&rsquo;t start here, so it was refused. Try again from
          this page.
        </p>
      )}
      {outcome === "denied" && (
        <p role="status" className="prompt">
          No problem — nothing was connected.
        </p>
      )}
      {outcome === "failed" && (
        <p role="alert" className="error">
          Last.fm couldn&rsquo;t complete that just now. Nothing was changed.
        </p>
      )}
      {outcome === "unconfigured" && (
        <p role="alert" className="error">
          Last.fm sign-in isn&rsquo;t set up on this server yet.
        </p>
      )}

      {current ? (
        <>
          <p className="note">
            Connected to{" "}
            <a
              href={`https://www.last.fm/user/${encodeURIComponent(current)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>{current}</strong>
            </a>
            . Your recent plays appear on your notes page so you can jot one down while
            it&rsquo;s fresh.
          </p>
          <div className="row">
            <ConfirmButton
              label="Disconnect Last.fm"
              title="Disconnect Last.fm?"
              body={
                <>
                  <p>
                    Your notes and your listening history in TrackJot are{" "}
                    <strong>kept</strong> — disconnecting a source is not a request to
                    delete your own writing.
                  </p>
                  <p>
                    Recent plays stop appearing, and the stored connection is deleted. You
                    can also revoke it from{" "}
                    <a
                      href="https://www.last.fm/settings/applications"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Last.fm&rsquo;s own settings
                    </a>
                    .
                  </p>
                </>
              }
              confirmLabel="Disconnect"
              formAction={unlinkLastfmAction}
            />
          </div>
        </>
      ) : authAvailable ? (
        /* A plain link: the browser has to make this navigation itself. */
        <p>
          <a className="download" href="/api/lastfm/start">
            Connect Last.fm
          </a>
        </p>
      ) : (
        <p className="note">
          Last.fm sign-in isn&rsquo;t configured on this server.
        </p>
      )}

      <p className="note">
        You approve this on Last.fm&rsquo;s own site. It is <strong>not</strong> a way to
        sign in to TrackJot, and TrackJot never sees your Last.fm password. Signing in is
        what lets it read your history even if you have hidden it from the public — which
        is exactly the case that a username alone cannot handle. Last.fm doesn&rsquo;t
        license its cover art for use here, so plays show none until the track is
        identified through a service that does.
      </p>
    </div>
  );
}
