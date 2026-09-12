"use client";

import type { DatePrecision } from "@prisma/client";
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
  knownPlaces = [],
}: {
  idPrefix: string;
  placeLabel: string | null;
  /** This writer's own previous places, most used first. */
  knownPlaces?: string[];
}) {
  return (
    <fieldset className="sub-fields">
      <legend>Where you were</legend>
      <div className="field">
        <label htmlFor={`${idPrefix}-place`}>Place</label>
        {/*
          A datalist rather than a bespoke combobox. It gives suggestion,
          free typing and keyboard support from the platform, and — unlike the
          tag input — there is no need to parse a list out of one field, so the
          extra machinery would buy nothing.
        */}
        <input
          id={`${idPrefix}-place`}
          name="placeLabel"
          defaultValue={placeLabel ?? ""}
          placeholder="A city or a venue"
          maxLength={200}
          list={`${idPrefix}-places`}
          autoComplete="off"
        />
        <datalist id={`${idPrefix}-places`}>
          {knownPlaces.map((place) => (
            <option key={place} value={place} />
          ))}
        </datalist>
        <p className="note hint">
          Anywhere that means something to you — a city, a venue, someone&rsquo;s
          kitchen, a train. Saved with this note only, never shared on a public page.
        </p>
      </div>
    </fieldset>
  );
}
