import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One shared password, a signed session, constant-time compares — the gate
 * /kitchen has had since it shipped, made once and instanced per door so
 * /pantry does not fork it. Pure on purpose: no request APIs live here, so
 * the check script can pin the token maths without a Next runtime. `auth.ts`
 * adds the cookie read.
 *
 * What it is not is a reason to be sloppy about the parts that are cheap to
 * get right: the comparison is constant-time, the session is a signed token
 * rather than the password echoed back into a cookie, and an unset password
 * means the door does not exist.
 */

/** Long enough to read the numbers over a morning; short enough that a borrowed laptop forgets. */
const SESSION_MS = 12 * 60 * 60 * 1000;

export interface Gate {
  /** Cookie name; also the key-derivation prefix, so two doors never share a session. */
  readonly cookie: string;
  /** Null when the env var is unset or blank: the door does not exist. */
  password(): string | null;
  /** A session token: the expiry, and a signature over it. The password itself never goes into the cookie. */
  issueToken(password: string): { value: string; maxAge: number };
  tokenValid(token: string | undefined, password: string): boolean;
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
 * `name` is the door ("kitchen", "pantry"); the other two are env variable
 * names. The signing key derives from the password unless the secret var is
 * set, so the common case is one variable rather than two — and changing the
 * password invalidates every live session, which is exactly what you want the
 * day somebody leaves.
 */
export function makeGate(name: string, passwordVar: string, secretVar: string): Gate {
  const secret = (password: string) => process.env[secretVar]?.trim() || `${name}:${password}`;
  const sign = (value: string, password: string) =>
    createHmac("sha256", secret(password)).update(value).digest("hex");

  return {
    cookie: `kc_${name}`,
    password() {
      const value = process.env[passwordVar]?.trim();
      return value ? value : null;
    },
    issueToken(password) {
      const expiry = String(Date.now() + SESSION_MS);
      return { value: `${expiry}.${sign(expiry, password)}`, maxAge: Math.floor(SESSION_MS / 1000) };
    },
    tokenValid(token, password) {
      if (!token) return false;
      const [expiry, signature] = token.split(".");
      if (!expiry || !signature) return false;
      if (!safeEqual(signature, sign(expiry, password))) return false;
      const at = Number(expiry);
      return Number.isFinite(at) && at > Date.now();
    },
  };
}
