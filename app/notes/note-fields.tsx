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
      <div className="row">
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
      */}
      <label className="checkbox">
        <input
          type="checkbox"
          name="placePrecision"
          value="exact"
          defaultChecked={placePrecision === "exact"}
        />
        <span>
          Remember this precisely. Otherwise only the name above is kept — no coordinates.
        </span>
      </label>
    </fieldset>
  );
}
