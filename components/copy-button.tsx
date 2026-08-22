"use client";

import { useState } from "react";

/**
 * Copy a share link, rather than printing it.
 *
 * A raw URL on the page was noise on every shared note — long, unclickable, and
 * something people had to select by hand. What they actually want is the link
 * on their clipboard, so that is the control.
 *
 * The URL stays in the DOM as the button's accessible description, so it is
 * still reachable by a screen reader and by anyone who wants to read it, and it
 * is still what gets copied — a button that copies something the user cannot
 * inspect is a small act of faith to ask for.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied
      // permission). Falling back to selecting the text lets the user copy it
      // themselves rather than leaving a button that silently does nothing.
      window.prompt("Copy this link", value);
    }
  }

  return (
    <button type="button" className="linkish copy" onClick={copy} title={value}>
      {copied ? "Copied" : label}
      <span className="visually-hidden"> — {value}</span>
    </button>
  );
}
