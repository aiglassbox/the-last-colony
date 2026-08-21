import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

/**
 * The gate on /kitchen.
 *
 * One shared password, set by whoever runs the project, and no accounts. That
 * is the right size for this: the dashboard is read by three people who already
 * share a Vercel login, and a user table would be more surface than the thing
 * it protects. What it is not is a reason to be sloppy about the parts that are
 * cheap to get right — the comparison is constant-time, the session is a signed
 * token rather than the password echoed back into a cookie, and a wrong guess
 * costs the same 404 as a route that was never configured.
 *
 * Unset `KITCHEN_PASSWORD` means the dashboard does not exist. It fails closed
 * for the same reason `/api/email-report` does: an analytics page that quietly
 * serves everybody because somebody forgot a variable is worse than no page.
 */

const COOKIE = "kc_kitchen";

/** Long enough to read the numbers over a morning; short enough that a borrowed laptop forgets. */
const SESSION_MS = 12 * 60 * 60 * 1000;

export function kitchenPassword(): string | null {
  const value = process.env.KITCHEN_PASSWORD?.trim();
  return value ? value : null;
}

/**
 * The signing key.
 *
 * Derived from the password unless `KITCHEN_SECRET` is set, so the common case
 * is one variable rather than two. The derivation is deliberate in one respect:
 * changing the password invalidates every live session, which is exactly what
 * you want the day somebody leaves.
 */
function secret(password: string): string {
  return process.env.KITCHEN_SECRET?.trim() || `kitchen:${password}`;
}

function sign(value: string, password: string): string {
  return createHmac("sha256", secret(password)).update(value).digest("hex");
}

/** Constant-time over equal-length inputs; length alone is not a secret here. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function passwordMatches(supplied: unknown, expected: string): boolean {
  return typeof supplied === "string" && safeEqual(supplied, expected);
}

/**
 * A session token: the expiry, and a signature over it.
 *
 * The password itself never goes into the cookie. If it did, every session
 * would be a copy of the credential sitting in a browser jar, readable by
 * anything that gets a moment alone with the device — and rotating it would be
 * the only way to revoke one.
 */
export function issueToken(password: string): { value: string; maxAge: number } {
  const expiry = String(Date.now() + SESSION_MS);
  return { value: `${expiry}.${sign(expiry, password)}`, maxAge: Math.floor(SESSION_MS / 1000) };
}

export function tokenValid(token: string | undefined, password: string): boolean {
  if (!token) return false;
  const [expiry, signature] = token.split(".");
  if (!expiry || !signature) return false;
  if (!safeEqual(signature, sign(expiry, password))) return false;

  const at = Number(expiry);
  return Number.isFinite(at) && at > Date.now();
}

export const COOKIE_NAME = COOKIE;

/**
 * Whether the caller may read the dashboard.
 *
 * Returns `"unconfigured"` rather than `false` for a deployment with no
 * password, because the page answers those two cases differently: one shows a
 * login form, the other shows nothing at all.
 */
export async function kitchenAccess(): Promise<"granted" | "denied" | "unconfigured"> {
  const password = kitchenPassword();
  if (!password) return "unconfigured";

  const jar = await cookies();
  return tokenValid(jar.get(COOKIE)?.value, password) ? "granted" : "denied";
}
