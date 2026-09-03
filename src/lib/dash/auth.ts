import { cookies } from "next/headers";

import { makeGate, type Gate } from "./gate";

export { passwordMatches } from "./gate";

/**
 * The two doors.
 *
 * The kitchen: one shared password, read by three people who already share a
 * Vercel login; a user table would be more surface than the thing it protects.
 * The pantry: community submissions with the submitters' contact details, so
 * its own password and its own cookie — a kitchen session opens nothing here.
 *
 * Unset password means the door does not exist. Both fail closed for the same
 * reason `/api/email-report` does: a page that quietly serves everybody because
 * somebody forgot a variable is worse than no page.
 */
export const kitchen = makeGate("kitchen", "KITCHEN_PASSWORD", "KITCHEN_SECRET");
export const pantry = makeGate("pantry", "ADMIN_PASSWORD", "ADMIN_SECRET");

export type Access = "granted" | "denied" | "unconfigured";

/**
 * Whether the caller may pass a door.
 *
 * Returns `"unconfigured"` rather than `false` for a deployment with no
 * password, because the page answers those two cases differently: one shows a
 * login form, the other shows nothing at all.
 */
export async function access(gate: Gate): Promise<Access> {
  const password = gate.password();
  if (!password) return "unconfigured";

  const jar = await cookies();
  return gate.tokenValid(jar.get(gate.cookie)?.value, password) ? "granted" : "denied";
}

export const kitchenAccess = (): Promise<Access> => access(kitchen);
export const pantryAccess = (): Promise<Access> => access(pantry);
