import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * The email OTP rules, as pure functions over one document and a clock.
 *
 * Every number the spec fixes lives in `OTP`, and every decision — may this
 * email be sent a code now, does this code verify, may this proof be spent —
 * is answered here without Mongo or the network, so `scripts/check-otp.ts`
 * can walk a whole life of one address offline. `otp.ts` wraps these in
 * reads and writes and nothing else.
 *
 * Imports node:crypto, so nothing a client component imports may import this.
 * The email shape rule is in schema.ts for that reason.
 */

export const OTP = {
  /** A code lives this long from the send. */
  lifeMs: 5 * 60_000,
  /** No second send to the same email inside this. */
  cooldownMs: 180_000,
  /** Sends are counted per email inside a window this long... */
  windowMs: 5 * 60_000,
  /** ...and capped at this. With the cooldown only two fit; three is the backstop. */
  maxSends: 3,
  /** Wrong tries against one code before it locks. */
  maxAttempts: 3,
  /** A verification may be spent on a submission for this long. */
  holdMs: 15 * 60_000,
} as const;

/** One per email. Replaced whole on every send; never carries a plain code. */
export interface OtpDoc {
  email: string;
  /** HMAC-SHA256 of the code, keyed with RESEND_API_KEY. */
  code_hash: string;
  expires_at: Date;
  /** Wrong tries against the current code. */
  attempts: number;
  /** Sends inside the window that opened at `window_start`. */
  sends: number;
  window_start: Date;
  last_sent_at: Date;
  /** Set by a correct code, wiped by the next send. */
  verified_at?: Date;
  /** 32 random bytes as hex, set beside `verified_at`; the submit must carry it. */
  proof?: string;
  /** Set by the submission that spent the verification. */
  consumed_at?: Date;
  /** The TTL index runs from here: an hour after the last touch. */
  updated_at: Date;
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string, key: string): string {
  return createHmac("sha256", key).update(code).digest("hex");
}

/** Constant-time; a malformed stored hash compares as a mismatch rather than throwing. */
export function codeMatches(code: string, hash: string, key: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(hash)) return false;
  const a = Buffer.from(hashCode(code, key), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newProof(): string {
  return randomBytes(32).toString("hex");
}

export type SendDecision =
  | { ok: true; doc: OtpDoc }
  | { ok: false; reason: "cooldown" | "cap"; retryAfter: number };

/**
 * The document to write for a send, or why not. The returned document is a
 * whole replacement: a new send always starts clean, with no verification,
 * no proof and no consumption carried over from the last code.
 */
export function decideSend(existing: OtpDoc | null, email: string, code: string, key: string, now: Date): SendDecision {
  const t = now.getTime();
  const windowOpen = existing !== null && t - existing.window_start.getTime() < OTP.windowMs;
  if (existing) {
    const sinceLast = t - existing.last_sent_at.getTime();
    if (sinceLast < OTP.cooldownMs) {
      return { ok: false, reason: "cooldown", retryAfter: Math.ceil((OTP.cooldownMs - sinceLast) / 1000) };
    }
    if (windowOpen && existing.sends >= OTP.maxSends) {
      return { ok: false, reason: "cap", retryAfter: Math.ceil((existing.window_start.getTime() + OTP.windowMs - t) / 1000) };
    }
  }
  return {
    ok: true,
    doc: {
      email,
      code_hash: hashCode(code, key),
      expires_at: new Date(t + OTP.lifeMs),
      attempts: 0,
      sends: windowOpen && existing ? existing.sends + 1 : 1,
      window_start: windowOpen && existing ? existing.window_start : now,
      last_sent_at: now,
      updated_at: now,
    },
  };
}

export type VerifyDecision =
  | { ok: true; proof: string }
  | {
      ok: false;
      reason: "expired" | "locked" | "wrong_code";
      attemptsLeft: number;
      /** True when this call was a wrong guess the store must record. */
      count: boolean;
    };

/**
 * Whether `code` verifies the document now. A missing, expired or already
 * verified document is `expired` — all three mean "send a new code" to the
 * form, and telling them apart would only say which emails have documents.
 */
export function decideVerify(doc: OtpDoc | null, code: string, key: string, now: Date): VerifyDecision {
  if (!doc || doc.verified_at || doc.expires_at.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired", attemptsLeft: 0, count: false };
  }
  if (doc.attempts >= OTP.maxAttempts) {
    return { ok: false, reason: "locked", attemptsLeft: 0, count: false };
  }
  if (!codeMatches(code, doc.code_hash, key)) {
    const attemptsLeft = OTP.maxAttempts - doc.attempts - 1;
    return { ok: false, reason: attemptsLeft > 0 ? "wrong_code" : "locked", attemptsLeft, count: true };
  }
  return { ok: true, proof: newProof() };
}

/** Whether a submission carrying `email` and `proof` may spend this verification now. */
export function canConsume(doc: OtpDoc | null, email: string, proof: string, now: Date): boolean {
  if (!doc || doc.email !== email || !doc.verified_at || !doc.proof || doc.consumed_at) return false;
  const a = Buffer.from(proof);
  const b = Buffer.from(doc.proof);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return now.getTime() - doc.verified_at.getTime() <= OTP.holdMs;
}
