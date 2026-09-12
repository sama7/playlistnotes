"use client";

import { useState } from "react";
import { setTimeZoneAction } from "./actions";

/**
 * The zone this account reads and writes times in.
 *
 * Every timestamp is stored as an instant; this decides how one is rendered and
 * how a calendar-day filter is bounded. Both mattered before it existed: the
 * product showed New York time to everybody, and a listen at 11pm on the 8th in
 * New York was excluded by a filter for the 8th because the bounds were UTC.
 *
 * The browser's own guess is offered as the first option rather than imposed.
 * `Intl` knows the device's zone, which is almost always right and occasionally
 * very wrong — a VPN, a borrowed laptop, a phone that never left airplane mode
 * — and this is a setting about where the writer lives, not where their
 * hardware thinks it is.
 */
export function TimeZoneForm({ current }: { current: string | null }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = supportedZones(guess, current);

  async function save(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      const result = await setTimeZoneAction(formData);
      if (result.error) setError(result.error);
      else setSaved(result.saved ?? null);
    } catch {
      setError("That didn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={save} className="capture">
      <div className="field">
        <label htmlFor="timeZone">Time zone</label>
        <select
          id="timeZone"
          name="timeZone"
          defaultValue={current ?? guess}
          aria-describedby="hint-tz"
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone === guess ? `${zone} — this device` : zone}
            </option>
          ))}
        </select>
        <p id="hint-tz" className="note hint">
          Used for the times shown on your notes and for date filters. Changing it
          never changes when anything happened — only how it reads.
        </p>
      </div>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="success">
          Times now read in <strong>{saved}</strong>.
        </p>
      )}

      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save time zone"}
      </button>
    </form>
  );
}

/**
 * Every zone the runtime knows, with the device's guess and the current setting
 * pinned to the top so neither takes scrolling to find.
 *
 * `supportedValuesOf` is the standard list and is widely available; where it is
 * not, a short fallback keeps the control usable rather than empty.
 */
function supportedZones(guess: string, current: string | null): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Karachi"];
  }
  const pinned = [current, guess].filter((z): z is string => Boolean(z));
  const rest = all.filter((z) => !pinned.includes(z));
  return [...new Set([...pinned, ...rest])];
}
