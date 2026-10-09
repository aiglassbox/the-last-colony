import { randomBytes } from "node:crypto";

/**
 * A person's unsubscribe token, and a batch's id: random, not derived from
 * the address, so nobody can opt someone else out by guessing. Kept apart from
 * `links.ts` so nothing pulls `node:crypto` into a browser bundle by way of a
 * URL helper.
 */
export function newToken(): string {
  return randomBytes(18).toString("base64url");
}
