"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatExperienced } from "@/lib/format-date";
import type { ListenView } from "@/lib/listens/service";
import { shouldApply, shouldPoll } from "@/lib/listens/polling";
import { CoverArt } from "@/components/cover-art";
import type { TrackCandidate } from "@/lib/music/match-track";
import {
  candidatesAction,
  dismissLastfmPromptAction,
  importListenAction,
  recentListensAction,
  type RecentState,
} from "@/app/listens/actions";

/**
 * How often to re-read the feed. Tracks run three to five minutes, so this is
 * responsive without being wasteful — and it is per open tab, against an API
 * that is somebody else's to pay for.
 */
const POLL_MS = 30_000;

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
 *
 * **It then keeps itself current**, the way a Last.fm profile page does — you
 * should not have to reload to see what you just played. Three rules keep that
 * from being rude or disruptive:
 *
 *   - **Never while someone is writing.** An open jot box freezes the list
 *     completely: a refresh that reordered rows mid-sentence, or dropped the
 *     row being written about out of the top ten, would cost somebody their
 *     words. Both the polling and the *applying* of an in-flight reply are
 *     suppressed, so a request that started before they clicked cannot land
 *     underneath them either.
 *   - **Never in a background tab.** Polling somebody else's API while nobody
 *     is looking spends their rate limit for nothing.
 *   - **Immediately on return.** Coming back to the tab, or finishing a jot,
 *     refreshes at once rather than waiting out the interval.
 */
export function Scrobbles({ username }: { username: string }) {
  const [state, setState] = useState<RecentState | null>(null);
  const [writingFor, setWritingFor] = useState<string | null>(null);

  /**
   * Read by the polling loop, which must see the *current* value without being
   * torn down and rebuilt every time the editor opens or closes.
   */
  const writing = useRef<string | null>(null);
  const inFlight = useRef(false);

  const beginWriting = useCallback((sourceRef: string | null) => {
    writing.current = sourceRef;
    setWritingFor(sourceRef);
  }, []);

  /**
   * Fetch, without deciding anything. Returning the result rather than storing
   * it keeps the "should this be applied?" question at the call site, where the
   * answer depends on whether someone has since started writing.
   */
  const load = useCallback(async (): Promise<RecentState | null> => {
    // One request at a time. A slow reply must not stack up behind the timer.
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      return await recentListensAction();
    } catch {
      return { ok: false, message: "Last.fm isn't answering right now." };
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * Apply a reply — unless a jot box opened while it was in flight. That guard
   * is the one that matters: a request begun before the click must not land
   * underneath somebody mid-sentence.
   */
  const apply = useCallback((result: RecentState | null, stopped = false) => {
    if (result && shouldApply({ writing: writing.current, stopped })) setState(result);
  }, []);

  useEffect(() => {
    let stopped = false;

    const tick = () => {
      // The three rules live in `shouldPoll`, stated once and tested directly.
      if (!shouldPoll({ writing: writing.current, hidden: document.hidden, stopped })) return;
      void load().then((result) => apply(result, stopped));
    };

    tick();
    const timer = window.setInterval(tick, POLL_MS);

    // Coming back to the tab should show the truth at once, not in 30 seconds.
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, apply]);

  /** Finishing a jot resumes the feed and shows the result immediately. */
  const doneWriting = useCallback(() => {
    beginWriting(null);
    void load().then(apply);
  }, [beginWriting, load, apply]);

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
                  onClick={() => beginWriting(listen.sourceRef)}
                >
                  Jot this
                </button>
              )}

              {writingFor === listen.sourceRef && (
                <ScrobbleJot listen={listen} onDone={doneWriting} />
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
  const [candidates, setCandidates] = useState<TrackCandidate[] | null>(null);
  /** Index into `candidates`, or -1 for "none of these". Best match preselected. */
  const [chosen, setChosen] = useState(0);

  /**
   * Suggestions are fetched when the editor opens, not with the strip. Ten rows
   * would mean ten lookups against somebody else's rate limit to answer a
   * question nobody asked.
   */
  useEffect(() => {
    let cancelled = false;
    candidatesAction({ trackName: listen.trackName, artistName: listen.artistName }).then(
      (found) => {
        if (!cancelled) setCandidates(found);
      },
      () => {
        if (!cancelled) setCandidates([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [listen.trackName, listen.artistName]);

  async function save(formData: FormData) {
    setSaving(true);
    const result = await importListenAction({}, formData);
    setSaving(false);
    if (result.error) setError(result.error);
    else onDone();
  }

  const pick = candidates && chosen >= 0 ? candidates[chosen] : null;

  return (
    <form action={save} className="scrobble-jot inline-edit">
      <input type="hidden" name="sourceRef" value={listen.sourceRef} />
      {/* Carried so a track still playing — which has no stored row yet — can be
          written down at the moment it matters. */}
      <input type="hidden" name="trackName" value={listen.trackName} />
      <input type="hidden" name="artistName" value={listen.artistName} />
      <input type="hidden" name="albumName" value={listen.albumName ?? ""} />
      <input type="hidden" name="url" value={listen.url ?? ""} />
      {/* Only the identifier travels. Everything else is re-read server-side
          from the provider, so this cannot inject a title or an image URL. */}
      <input type="hidden" name="confirmedProvider" value={pick?.provider ?? ""} />
      <input type="hidden" name="confirmedId" value={pick?.providerId ?? ""} />

      {candidates === null && <p className="note">Looking for this on Apple Music and Spotify…</p>}

      {candidates !== null && candidates.length > 0 && (
        <fieldset className="sub-fields match-picker">
          <legend>Is this the one?</legend>
          <p className="note">
            Last.fm didn&rsquo;t include an identifier for this play. Confirming a match
            gets you the cover art and links, and files it alongside the same track from
            anywhere else. Nothing is matched for you.
          </p>

          {candidates.map((candidate, index) => (
            <label key={`${candidate.provider}:${candidate.providerId}`} className="match">
              <input
                type="radio"
                name="candidate"
                checked={chosen === index}
                onChange={() => setChosen(index)}
              />
              <CoverArt
                url={candidate.artwork.thumbUrl}
                fullUrl={candidate.artwork.url}
                size={44}
                title={candidate.title}
              />
              <span className="match-text">
                <strong>{candidate.title}</strong>
                <span className="note">
                  {candidate.artistName}
                  {candidate.albumName ? ` · ${candidate.albumName}` : ""}
                </span>
                <span className="note">
                  {candidate.provider === "apple_music" ? "Apple Music" : "Spotify"}
                  {/* Terse on purpose: this line sits beside a 44px cover in a
                      ~265px column on a phone, and the wordier version was the
                      first thing to be ellipsed away. */}
                  {candidate.durationDeltaMs !== null &&
                    ` · within ${(candidate.durationDeltaMs / 1000).toFixed(1)}s`}
                </span>
              </span>
            </label>
          ))}

          <label className="match match-none">
            <input
              type="radio"
              name="candidate"
              checked={chosen === -1}
              onChange={() => setChosen(-1)}
            />
            <span className="match-text">
              <strong>None of these</strong>
              <span className="note">
                Keep it as your own entry — private to you, and no cover art.
              </span>
            </span>
          </label>
        </fieldset>
      )}

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
          Dated {listen.playedAt ? formatExperienced(listen.playedAt, "time") : "now"}
          {pick ? "" : " · stays private to you"}
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
