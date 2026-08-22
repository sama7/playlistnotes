"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
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
