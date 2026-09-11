"use client";

import { useMemo, useRef, useState } from "react";

/**
 * A comma-separated tag field that completes what you've already used.
 *
 * A plain `<datalist>` was the cheap option and the wrong one: it matches
 * against the *whole* input value, so once a field reads `live, ` it stops
 * suggesting anything. Tags are entered as a list, so completion has to work on
 * the token under the cursor — which is the behaviour people know from
 * Letterboxd and every other tag field worth using.
 *
 * The value stays a single string rather than an array of chips. That keeps the
 * field's meaning exact: what you see is what gets saved, and deleting a word
 * deletes the tag. A chip editor would need its own remove affordance to say the
 * same thing, and would still have to fall back to typing.
 */
export function TagInput({
  id,
  name,
  defaultValue,
  suggestions,
}: {
  id: string;
  name: string;
  defaultValue: string;
  /** Tag names this user already has, most-used first. */
  suggestions: string[];
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Everything before the last comma is settled; the tail is being typed.
  const { head, tail } = useMemo(() => splitTail(value), [value]);
  const chosen = useMemo(
    () => new Set(head.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)),
    [head],
  );

  const matches = useMemo(() => {
    const needle = tail.trim().toLowerCase();
    return suggestions
      .filter((s) => !chosen.has(s.toLowerCase()))
      .filter((s) => (needle ? s.toLowerCase().includes(needle) : true))
      .slice(0, 6);
  }, [suggestions, chosen, tail]);

  const showList = open && matches.length > 0;

  function complete(tag: string) {
    const next = head ? `${head.replace(/,\s*$/, "")}, ${tag}, ` : `${tag}, `;
    setValue(next);
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  return (
    <div className="tag-input">
      <input
        ref={inputRef}
        id={id}
        name={name}
        value={value}
        autoComplete="off"
        // Two example tags rather than a description of the format. The
        // visually-hidden label already says "Tags, separated by commas" for
        // anyone who needs it read out; visually, a comma between two words
        // teaches the convention in a third of the width — and the description
        // did not fit the box on a phone, where this input has about 139px of
        // text room after its padding.
        placeholder="qawwali, live"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // A click on a suggestion blurs the input first, so closing has to wait
        // for the click to land. 150ms is the usual compromise.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!showList) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => (i - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter" && matches[active]) {
            // Only intercept Enter while a suggestion is highlighted — otherwise
            // it must still submit the form, which is how most people save.
            event.preventDefault();
            complete(matches[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {showList && (
        <ul className="suggestions" id={`${id}-suggestions`} role="listbox">
          {matches.map((tag, index) => (
            <li key={tag}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? "active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => complete(tag)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function splitTail(value: string): { head: string; tail: string } {
  const at = value.lastIndexOf(",");
  return at === -1
    ? { head: "", tail: value }
    : { head: value.slice(0, at + 1), tail: value.slice(at + 1) };
}
