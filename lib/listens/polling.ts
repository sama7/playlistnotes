/**
 * When the recently-played strip may refresh itself, and when it may apply what
 * comes back.
 *
 * These are two decisions rather than one, and separating them is the point.
 * Not polling is easy; the harder case is a request that was already in flight
 * when someone clicked "Jot this". Applying that reply would reorder rows under
 * a half-written sentence, or drop the row being written about out of the top
 * ten entirely — and the words go with it.
 *
 * Pure and tiny so the rule can be stated once and tested directly, rather than
 * inferred from an interval, a visibility listener and two refs.
 */

export interface PollConditions {
  /** The sourceRef of the row whose jot box is open, if any. */
  writing: string | null;
  /** `document.hidden` — nobody is looking at this tab. */
  hidden: boolean;
  /** The component has unmounted, or the effect has been torn down. */
  stopped: boolean;
}

/**
 * Whether to ask Last.fm again.
 *
 * Writing wins over everything: an open jot box freezes the list completely.
 * A background tab is excluded because polling somebody else's API while nobody
 * is looking spends their rate limit for nothing.
 */
export function shouldPoll({ writing, hidden, stopped }: PollConditions): boolean {
  return !stopped && !hidden && writing === null;
}

/**
 * Whether to show a reply that has arrived.
 *
 * Deliberately **not** the same test as `shouldPoll`: a hidden tab may still
 * apply a result it already asked for — there is no harm in being up to date
 * when the person looks back — but a jot box opened mid-flight must still
 * suppress it.
 */
export function shouldApply({ writing, stopped }: Omit<PollConditions, "hidden">): boolean {
  return !stopped && writing === null;
}
