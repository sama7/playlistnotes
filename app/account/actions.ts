"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { RecordingOrigin } from "@prisma/client";
import { describeProblem, setUsername } from "@/lib/users/username";

export interface UsernameState {
  error?: string;
  saved?: string;
}

/**
 * Claim or change a username.
 *
 * The acting user comes from the session, never from the form — the same rule
 * every other mutation follows, and the one v1 broke.
 */
export async function setUsernameAction(
  _previous: UsernameState,
  formData: FormData,
): Promise<UsernameState> {
  const user = await requireUser();
  const requested = String(formData.get("username") ?? "");

  const result = await setUsername(user.id, requested);
  if (!result.ok) return { error: describeProblem(result.problem) };

  revalidatePath("/account");
  return { saved: result.username };
}


export interface TimeZoneState {
  error?: string;
  saved?: string;
}

/**
 * Choose the zone this account reads times in.
 *
 * Validated against the runtime's own zone database rather than a regex. An
 * unknown IANA name would not fail here — it would fail later, inside
 * `Intl.DateTimeFormat` during a render, turning a bad setting into a broken
 * page. Asking `Intl` whether it knows the name is the same check the renderer
 * will make, made early.
 */
export async function setTimeZoneAction(formData: FormData): Promise<TimeZoneState> {
  const user = await requireUser();
  const requested = String(formData.get("timeZone") ?? "").trim();
  if (!requested) return { error: "Pick a time zone." };

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: requested });
  } catch {
    return { error: "That is not a time zone this server recognises." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { timeZone: requested } });

  revalidatePath("/account");
  revalidatePath("/notes");
  revalidatePath("/collections");
  return { saved: requested };
}


export interface DangerState {
  error?: string;
  done?: string;
}

/**
 * Delete the imported listening history, keeping the writing.
 *
 * Disconnecting Last.fm deliberately keeps your listens and the notes made from
 * them — a source setting is not a request to delete your own writing. But that
 * left no way to say the other thing: "I want the history itself gone." This is
 * that, and it is careful about the difference.
 *
 * A listen that became a note is **not** deleted. The note is the writing, the
 * listen is the evidence it came from, and the recording it resolved to is what
 * makes the note render at all. Unimported listens carry no writing and are
 * pure history, so those go. Saying so plainly in the UI matters more than the
 * distinction being clever.
 */
export async function deleteListeningHistoryAction(): Promise<DangerState> {
  const user = await requireUser();

  const { count } = await prisma.listen.deleteMany({
    where: { ownerId: user.id, importedAt: null },
  });

  revalidatePath("/account");
  revalidatePath("/notes");
  return {
    done:
      count === 0
        ? "There was no unwritten listening history to delete."
        : `Deleted ${count} listen${count === 1 ? "" : "s"} you hadn’t written about.`,
  };
}

/**
 * Delete the account and everything in it.
 *
 * Typing the username back is the confirmation, not a checkbox: this is the one
 * action in the product with no undo, and it should cost a deliberate sentence.
 *
 * The local row goes and every owned row goes with it by cascade. The auth
 * provider's record is **not** deleted here, and that is stated in the UI rather
 * than hidden: Clerk owns that lifecycle, and quietly implying otherwise would
 * be the same class of untrue-privacy-claim as the collection footer.
 */
export async function deleteAccountAction(formData: FormData): Promise<DangerState> {
  const user = await requireUser();
  const typed = String(formData.get("confirm") ?? "").trim();
  const expected = user.username ?? "delete my account";

  if (typed.toLowerCase() !== expected.toLowerCase()) {
    return { error: `Type “${expected}” exactly to confirm.` };
  }

  /**
   * Their own typed-in entries go too.
   *
   * Everything owned cascades from the user row, but `recordings.created_by` is
   * `SET NULL` — so a manually entered recording would outlive the account that
   * typed it, as an orphan nobody can reach and nobody agreed to leave behind.
   * These are `origin = user` and creator-scoped by policy, so no other
   * member's note can be pointing at one; collecting the ids before the delete
   * is the only way to find them afterwards, since the column that identifies
   * them is the one being nulled.
   *
   * Catalog rows that came from a provider are deliberately kept: those are not
   * this person's data, they are the shared catalog other people's notes hang
   * from.
   */
  const authored = await prisma.recording.findMany({
    where: { origin: RecordingOrigin.user, createdById: user.id },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: user.id } });
    if (authored.length > 0) {
      await tx.recording.deleteMany({ where: { id: { in: authored.map((r) => r.id) } } });
    }
  });

  return { done: "Your account and everything in it has been deleted." };
}
