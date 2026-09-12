"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
