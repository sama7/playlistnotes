"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatExperienced } from "@/lib/format-date";
import type { ListenView } from "@/lib/listens/service";
import {
  dismissLastfmPromptAction,
  importListenAction,
  recentListensAction,
  type RecentState,
} from "@/app/listens/actions";

/**
 * What you have been listening to, offered as things to write about.
 *
 * This answers "what should I write about?" — the question a blank journal
 * always asks and rarely helps with. You see something you heard this morning,
 * tap it, and capture the association while it is still there.
 *
 * **It loads after the page, not with it.** The contract is explicit that a
 * request handler must not wait on Last.fm, and the notes page is the one screen
 * that has to be fast. So the server renders everything else and this fetches
 * itself afterwards; if Last.fm is slow or down, the strip says so and nothing
 * else on the page is affected.
 */
export function Scrobbles({ username }: { username: string }) {
  const [state, setState] = useState<RecentState | null>(null);
  const [writingFor, setWritingFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The state update happens in the promise callback, not in the effect body,
    // and is dropped if the component went away while Last.fm was answering.
    recentListensAction().then(
      (result) => {
        if (!cancelled) setState(result);
      },
      () => {
        if (!cancelled) {
          setState({ ok: false, message: "Last.fm isn't answering right now." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="scrobbles">
      <div className="row scrobbles-head">
        <strong>Recently played</strong>
        <span className="note">
          from{" "}
          <a
            href={`https://www.last.fm/user/${encodeURIComponent(username)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {username}
          </a>{" "}
          on Last.fm
        </span>
      </div>

      {state === null && <p className="note">Looking at what you&rsquo;ve been playing…</p>}

      {state?.ok === false && <p className="note">{state.message}</p>}

      {state?.ok && state.listens.length === 0 && (
        <p className="note">Nothing scrobbled yet.</p>
      )}

      {state?.ok && state.listens.length > 0 && (
        <ul className="scrobble-list">
          {state.listens.map((listen) => (
            <li key={listen.sourceRef} className="scrobble">
              <div className="scrobble-main">
                <div className="scrobble-title">
                  {listen.url ? (
                    <a href={listen.url} target="_blank" rel="noopener noreferrer">
                      {listen.trackName}
                    </a>
                  ) : (
                    listen.trackName
                  )}
                </div>
                <div className="note">
                  {listen.artistName}
                  {listen.albumName ? ` · ${listen.albumName}` : ""}
                </div>
                <div className="note scrobble-when">
                  {listen.playedAt
                    ? formatExperienced(listen.playedAt, "time")
                    : "Playing now"}
                </div>
              </div>

              {listen.importedNoteId ? (
                <span className="note">Jotted</span>
              ) : writingFor === listen.sourceRef ? null : (
                <button
                  type="button"
                  className="linkish"
                  aria-label={`Write about ${listen.trackName} by ${listen.artistName}`}
                  onClick={() => setWritingFor(listen.sourceRef)}
                >
                  Jot this
                </button>
              )}

              {writingFor === listen.sourceRef && (
                <ScrobbleJot
                  listen={listen}
                  onDone={() => setWritingFor(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="note">
        Last.fm doesn&rsquo;t license cover art for use here, so these show none until the
        track is identified through a service that does.
      </p>
    </section>
  );
}

/**
 * The jot itself.
 *
 * The listening instant is preserved as the note's date — the reason this
 * integration exists — so a note written tonight about something heard at
 * lunchtime is dated lunchtime, not now.
 */
function ScrobbleJot({ listen, onDone }: { listen: ListenView; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(formData: FormData) {
    setSaving(true);
    const result = await importListenAction({}, formData);
    setSaving(false);
    if (result.error) setError(result.error);
    else onDone();
  }

  return (
    <form action={save} className="scrobble-jot inline-edit">
      <input type="hidden" name="sourceRef" value={listen.sourceRef} />
      {/* Carried so a track still playing — which has no stored row yet — can be
          written down at the moment it matters. */}
      <input type="hidden" name="trackName" value={listen.trackName} />
      <input type="hidden" name="artistName" value={listen.artistName} />
      <input type="hidden" name="albumName" value={listen.albumName ?? ""} />
      <input type="hidden" name="url" value={listen.url ?? ""} />

      <label className="visually-hidden" htmlFor={`jot-${listen.sourceRef}`}>
        Your note about {listen.trackName}
      </label>
      <textarea
        id={`jot-${listen.sourceRef}`}
        name="body"
        rows={3}
        autoFocus
        placeholder={`What do you want to remember about ${listen.trackName}?`}
      />

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="row">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save jot"}
        </button>
        <button type="button" className="linkish" onClick={onDone}>
          Cancel
        </button>
        <span className="note">
          Dated{" "}
          {listen.playedAt ? formatExperienced(listen.playedAt, "time") : "now"}
          {listen.identified ? "" : " · no MusicBrainz id, so this stays private to you"}
        </span>
      </div>
    </form>
  );
}

/**
 * The one-time offer to connect a listening history.
 *
 * Shown to someone who has not connected one and has not waved it away. It is
 * dismissible on purpose: an integration that keeps asking is an advertisement.
 */
export function LastfmPrompt() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <section className="lastfm-prompt">
      <strong>Connect Last.fm?</strong>
      <p className="note">
        If you scrobble, TrackJot can show what you have been playing so you can jot it
        down while it is fresh. You approve it on Last.fm&rsquo;s own site — it is not a
        way to sign in here, and TrackJot never sees your password.
      </p>
      <div className="row">
        <a className="download" href="/api/lastfm/start">
          Connect Last.fm
        </a>
        <button
          type="button"
          className="linkish"
          onClick={async () => {
            setHidden(true);
            await dismissLastfmPromptAction();
          }}
        >
          Not now
        </button>
        <span className="note">
          Or later, from <Link href="/account">your account</Link>.
        </span>
      </div>
    </section>
  );
}
