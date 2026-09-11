"use client";

import type { DatePrecision, PlacePrecision } from "@prisma/client";
import { toDateInputValue } from "@/lib/format-date";

/**
 * The two optional things a journal entry can carry beyond its text: when the
 * listening happened, and where.
 *
 * Both are shown inside the note editor rather than on the capture form. The
 * cost of asking is paid every time someone writes a note, and most notes are
 * about right now, in no particular place — so the fields live where someone
 * has already decided this entry deserves more than a sentence.
 */

export const DATE_PRECISIONS: Array<{ value: DatePrecision; label: string }> = [
  // `time` is deliberately absent: a date input collects a day, so offering
  // "that exact moment" here would let someone claim a precision the form
  // cannot express. It is set only by a source that reported an instant — a
  // scrobble — and an edit that keeps the date untouched keeps it.
  { value: "day", label: "That day" },
  { value: "month", label: "That month" },
  { value: "year", label: "That year" },
];

export function ExperiencedFields({
  idPrefix,
  experiencedAt,
  precision,
}: {
  idPrefix: string;
  experiencedAt: Date | null;
  precision: DatePrecision | null;
}) {
  return (
    <fieldset className="sub-fields">
      <legend>When you heard it</legend>
      <p className="note">
        Leave this empty for &ldquo;now&rdquo;. A gig in 2011 is dated 2011, not today.
      </p>
      {/*
        The instant and precision as stored, so a save that does not touch the
        date can put them back exactly. Without this, opening the editor on a
        note imported from a scrobble and pressing Save would quietly round a
        known minute down to a day — losing precision the user never chose to
        give up. Read back in `readJournalFields`.
      */}
      <input
        type="hidden"
        name="experiencedAtOriginal"
        value={experiencedAt ? new Date(experiencedAt).toISOString() : ""}
      />
      <input type="hidden" name="experiencedPrecisionOriginal" value={precision ?? ""} />

      {/*
        A grid, not a `.row`. A flex row centres two stacked fields of unequal
        height against each other — so "How sure" sat visibly below "Date" — and
        never stops squeezing, so on a phone the date input was drawn straight
        through the select beside it. `.field-row` stacks below 34rem instead.
      */}
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-experienced`}>Date</label>
          <input
            id={`${idPrefix}-experienced`}
            name="experiencedAt"
            type="date"
            defaultValue={experiencedAt ? toDateInputValue(experiencedAt) : ""}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-precision`}>How sure</label>
          {/*
            The date input always collects a full day, so this is what stops the
            product claiming a precision nobody offered: pick "That year" and
            only the year is ever shown back, whatever day the picker produced.
          */}
          <select
            id={`${idPrefix}-precision`}
            name="experiencedPrecision"
            defaultValue={precision ?? "day"}
          >
            {DATE_PRECISIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
}

export function PlaceFields({
  idPrefix,
  placeLabel,
  placePrecision,
}: {
  idPrefix: string;
  placeLabel: string | null;
  placePrecision: PlacePrecision | null;
}) {
  return (
    <fieldset className="sub-fields">
      <legend>Where you were</legend>
      <div className="field">
        <label htmlFor={`${idPrefix}-place`}>Place</label>
        <input
          id={`${idPrefix}-place`}
          name="placeLabel"
          defaultValue={placeLabel ?? ""}
          placeholder="A city, a venue, someone's kitchen"
          maxLength={200}
        />
      </div>
      {/*
        Coarse by default and only as precise as you ask for. A journal that
        quietly accumulates a movement history is a liability its writer never
        agreed to, so the exact option is a checkbox you tick, per note.

        **The copy here used to promise machinery that does not exist.** It read
        "Otherwise only the name above is kept — no coordinates", which invites
        the reader to conclude that ticking the box produces coordinates. It
        does not. Nothing in TrackJot geocodes a place, offers autocomplete, or
        writes `place_lat`/`place_lon` — the columns exist and the service will
        validate them, but no code path supplies them. All this box records is
        what the writer meant by the words they typed.

        Saying so in the control itself is the honest version, and it is also
        the answer to the question the old wording raised.
      */}
      <label className="checkbox">
        <input
          type="checkbox"
          name="placePrecision"
          value="exact"
          defaultChecked={placePrecision === "exact"}
        />
        <span>
          These words name an exact spot, not just the general area. Either way
          TrackJot saves only what you typed — it never looks the place up and
          never stores coordinates.
        </span>
      </label>
    </fieldset>
  );
}
