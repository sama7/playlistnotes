"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import {
  linkLastfmAction,
  unlinkLastfmAction,
  type LinkState,
} from "@/app/listens/actions";

/**
 * Connect or disconnect a listening history.
 *
 * The copy is careful about one thing, because the distinction is the whole
 * basis on which this is allowed to exist: a Last.fm username here is **a
 * source setting, not a login**. TrackJot reads a public profile. It is not
 * given access to the account, it does not verify that you own the profile, and
 * nothing about your TrackJot account depends on it.
 */
export function LastfmForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(linkLastfmAction, {});
  const linked = state.linked ?? current;

  return (
    <div className="capture">
      {linked ? (
        <>
          <p className="note">
            Connected to{" "}
            <a
              href={`https://www.last.fm/user/${encodeURIComponent(linked)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>{linked}</strong>
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
                  <p>Recent plays will stop appearing on your notes page.</p>
                </>
              }
              confirmLabel="Disconnect"
              formAction={unlinkLastfmAction}
            />
          </div>
        </>
      ) : (
        <form action={action} className="row">
          <label htmlFor="lastfm" className="visually-hidden">
            Last.fm username
          </label>
          <input
            id="lastfm"
            name="username"
            placeholder="Your Last.fm username"
            autoComplete="off"
            required
          />
          <button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Connect"}
          </button>
        </form>
      )}

      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}

      <p className="note">
        This reads a <strong>public profile</strong>. It is not a login and gives TrackJot
        no access to your Last.fm account — the username is simply the name of a feed to
        read. Last.fm doesn&rsquo;t license its cover art for use here, so plays show none
        until the track is identified through a service that does.
      </p>
    </div>
  );
}
