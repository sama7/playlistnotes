"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAccountAction, deleteListeningHistoryAction } from "./actions";

/**
 * The two ways out.
 *
 * Disconnecting Last.fm deliberately keeps your listens and the notes made from
 * them — a source setting is not a request to delete your writing. That was the
 * right call and it left a gap: there was no way to say the other thing. An
 * account you cannot leave, and a history you cannot erase, are not privacy
 * features however carefully the rest of the product behaves.
 *
 * Both are stated in terms of what survives, because that is the part people
 * actually need to predict.
 */
export function DangerZone({
  username,
  listeningHistoryAvailable,
}: {
  username: string | null;
  /**
   * Gated on the same feature flag as the rest of the integration.
   *
   * Without this the account page named Last.fm on a deployment that has no
   * Last.fm key — which the acceptance suite catches, correctly: an
   * unconfigured deployment must never mention an integration it cannot
   * perform. Offering to delete history that could not exist is also just
   * confusing. Deleting the account is unconditional; it is not about any
   * source.
   */
  listeningHistoryAvailable: boolean;
}) {
  return (
    <>
      <h2>Deleting things</h2>

      {listeningHistoryAvailable && <DeleteHistory />}
      <DeleteAccount username={username} />
    </>
  );
}

function DeleteHistory() {
  const [state, setState] = useState<{ error?: string; done?: string }>({});
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="capture"
      action={async () => {
        if (
          !confirm(
            "Delete the plays you haven’t written about? Listens you already jotted are kept, because deleting those would delete the notes.",
          )
        ) {
          return;
        }
        setBusy(true);
        try {
          setState(await deleteListeningHistoryAction());
        } catch {
          setState({ error: "That didn’t work. Try again." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="note">
        <strong>Imported listening history.</strong> Removes the plays TrackJot pulled
        from Last.fm that you never wrote about. Plays you did jot are kept — they are
        what those notes are dated from, so deleting them would take the notes with them.
      </p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status" className="success">
          {state.done}
        </p>
      )}
      <button type="submit" className="danger" disabled={busy}>
        {busy ? "Deleting…" : "Delete unwritten history"}
      </button>
    </form>
  );
}

function DeleteAccount({ username }: { username: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; done?: string }>({});
  const [busy, setBusy] = useState(false);
  const expected = username ?? "delete my account";

  if (state.done) {
    return (
      <p role="status" className="success">
        {state.done} <Link href="/">Back to the start</Link>.
      </p>
    );
  }

  return (
    <form
      className="capture"
      action={async (formData) => {
        setBusy(true);
        try {
          const result = await deleteAccountAction(formData);
          setState(result);
          // Nothing on this page belongs to anyone any more. `refresh()` as
          // well as `push()`: the router cache still holds the signed-in render
          // of the page being left, and without it the deleted account's own
          // notes flash back on the way out.
          if (result.done) {
            router.replace("/");
            router.refresh();
          }
        } catch {
          setState({ error: "That didn’t work. Try again." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="note">
        <strong>Your whole account.</strong> Every note, collection, tag, listen and
        anything you typed in yourself, permanently and immediately. Shared links stop
        working. This cannot be undone. Your sign-in with the email provider is separate
        and is not deleted here.
      </p>
      <div className="field">
        <label htmlFor="confirm">
          Type <strong>{expected}</strong> to confirm
        </label>
        <input id="confirm" name="confirm" autoComplete="off" />
      </div>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" className="danger" disabled={busy}>
        {busy ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
