"use client";

import { useActionState } from "react";
import { setUsernameAction, type UsernameState } from "./actions";

/**
 * Pick a handle.
 *
 * It lives on the account page rather than in the sign-up flow, and that is a
 * deliberate compromise: sign-up is Clerk's, and adding a required field to it
 * means either a custom flow or a Clerk-side setting whose validation we do not
 * control. Asking here keeps one source of truth for the rules — and the prompt
 * is unmissable while the field is empty, which is what matters before the
 * social surfaces exist.
 */
export function UsernameForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<UsernameState, FormData>(
    setUsernameAction,
    {},
  );

  return (
    <form action={action} className="capture">
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          defaultValue={current ?? ""}
          autoComplete="username"
          aria-describedby="hint-username"
          required
        />
        {/* The rule used to be the placeholder, where on a phone it was cut to
            "3–30 characters: letters, numbers, und" — and a placeholder also
            disappears the moment someone starts typing, which is when the rule
            is actually needed. Below the field it wraps, and it stays. */}
        <p id="hint-username" className="note hint">
          3–30 characters: letters, numbers, underscores.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="success">
          You&rsquo;re <strong>{state.saved}</strong>.
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : current ? "Change it" : "Claim it"}
      </button>

      <p className="note">
        Not shown to anyone yet. It is what a profile and a mention will use when
        following and tagging arrive, and claiming it now means not racing everyone
        else for it later.
      </p>
    </form>
  );
}
