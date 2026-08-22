"use client";

import { useRef, useState } from "react";

/**
 * A destructive action behind a real dialog.
 *
 * `window.confirm()` was doing this job and was wrong twice over. It cannot be
 * styled, so a permanent deletion looked like a browser error — and, more
 * seriously, **the OS dialog focuses OK by default**, so Return or a stray
 * click confirmed the deletion. The affirmative answer should never be the one
 * that happens by accident.
 *
 * So: a native `<dialog>` (Escape, the top layer and focus trapping come from
 * the platform), with **Cancel autofocused** and the destructive button styled
 * as the secondary choice. The button submits its parent form only after the
 * dialog is confirmed, so no-JS falls back to submitting directly — losing the
 * confirmation, not the ability to act.
 */
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  className,
  formAction,
}: {
  /** The visible trigger text. */
  label: string;
  /** The question, as a heading. */
  title: string;
  /** What will actually happen, in plain words. */
  body: React.ReactNode;
  confirmLabel: string;
  className?: string;
  /** Bound Server Action. Runs only after the dialog is confirmed. */
  formAction: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  function show() {
    setOpen(true);
    dialog.current?.showModal();
  }

  function dismiss() {
    dialog.current?.close();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={className ?? "linkish danger-text"}
        onClick={show}
      >
        {label}
      </button>

      <form ref={form} action={formAction} hidden />

      {/*
        Mounted only while open. The body quotes what is about to be deleted, so
        leaving it in a closed dialog put a second copy of every note's text on
        the page — invisible, but real to Ctrl+F, to a hundred-note render, and
        to anything that reads the document rather than looks at it.
      */}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirm-title"
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <h2 id="confirm-title">{title}</h2>
            <div className="confirm-body">{body}</div>
            <div className="confirm-actions">
              {/*
                Cancel first in the DOM and autofocused: the safe answer is the
                one Return and a mistimed click land on.
              */}
              <button type="button" autoFocus onClick={dismiss}>
                Keep it
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  dismiss();
                  form.current?.requestSubmit();
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
