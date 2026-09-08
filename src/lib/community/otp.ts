import type { Collection } from "mongodb";

import { communityDb } from "./client";
import { canConsume, decideSend, decideVerify, newCode, OTP, type OtpDoc } from "./otp-rules";

/**
 * The OTP store and the one call to Resend. Every decision is made in
 * otp-rules.ts; this file reads a document, asks, and writes what it was
 * told. Same store and same posture as submissions: `communityDb()` null is
 * "not now", never a crash, and a submission could not land without Atlas
 * anyway, so this adds no dependency.
 *
 * Nothing here logs a code or an address. Resend's error body can echo the
 * recipient, so only its status and error name reach the log.
 */

export const OTP_CODES = "otp_codes";

const FROM = "Kranti Cookbook <noreply@kranticookbook.com>";
const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 8000;

function apiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

async function codes(): Promise<Collection<OtpDoc> | null> {
  const db = await communityDb();
  return db ? db.collection<OtpDoc>(OTP_CODES) : null;
}

/** Logs which of the two fail-closed causes tripped a guard, so a dead form
 *  is debuggable. No address, no code. */
function logGuardMiss(key: string | null, col: Collection<OtpDoc> | null): void {
  if (!key) console.error("[otp] RESEND_API_KEY is not set");
  else if (!col) console.error("[otp] store unreachable");
}

/** One POST. True only on a 2xx. */
async function deliver(to: string, code: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: `Your Kranti Cookbook code: ${code}`,
        text: `Your code is ${code}. It expires in 5 minutes.\n\nIf you did not ask for this, ignore this email.`,
      }),
      // A timeout here returns false and the caller rolls the code back, even
      // though Resend may have sent it anyway — a send that lands after the
      // client gives up looks identical to one that never went out. Deliberate:
      // the tradeoff favours not charging a cooldown over never rolling back a
      // code that is sitting in the recipient's inbox. Do not "fix" this.
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
      console.error(`[otp] resend answered ${res.status}${typeof body?.name === "string" ? ` ${body.name}` : ""}`);
    }
    return res.ok;
  } catch (error) {
    console.error("[otp] resend call failed:", error instanceof Error ? error.name : error);
    return false;
  }
}

export type SendResult =
  | { ok: true; expiresIn: number; resendIn: number }
  | { ok: false; status: 429; reason: "cooldown" | "cap"; retryAfter: number }
  | { ok: false; status: 503 };

/**
 * Writes the new code first and sends second, and rolls the write back if
 * the mail never left: a person must not be charged a send, or start a
 * cooldown, for an email they did not get.
 *
 * ponytail: read-decide-replace is not atomic, so two sends landing together
 * can both pass the cooldown; the per-IP limiter is the real ceiling there.
 * And if the rollback write itself throws, the outer catch returns the
 * failure with the new send count and cooldown still in place — so the
 * person is charged a cooldown for mail they never received, the one thing
 * this write-then-send ordering exists to prevent.
 */
export async function sendCode(email: string, now = new Date()): Promise<SendResult> {
  const key = apiKey();
  const col = await codes();
  if (!key || !col) {
    logGuardMiss(key, col);
    return { ok: false, status: 503 };
  }
  try {
    const existing = await col.findOne({ email }, { maxTimeMS: 2000 });
    const code = newCode();
    const decision = decideSend(existing, email, code, key, now);
    if (!decision.ok) return { ok: false, status: 429, reason: decision.reason, retryAfter: decision.retryAfter };

    await col.replaceOne({ email }, decision.doc, { upsert: true });
    if (!(await deliver(email, code, key))) {
      if (existing) await col.replaceOne({ email }, existing);
      else await col.deleteOne({ email });
      return { ok: false, status: 503 };
    }
    return { ok: true, expiresIn: OTP.lifeMs / 1000, resendIn: OTP.cooldownMs / 1000 };
  } catch (error) {
    console.error("[otp] send failed:", error instanceof Error ? error.name : error);
    return { ok: false, status: 503 };
  }
}

export type VerifyResult =
  | { ok: true; proof: string; holdMinutes: number }
  | { ok: false; status: 400; reason: "wrong_code"; attemptsLeft: number }
  | { ok: false; status: 410; reason: "expired" | "locked" }
  | { ok: false; status: 503 };

export async function verifyCode(email: string, code: string, now = new Date()): Promise<VerifyResult> {
  const key = apiKey();
  const col = await codes();
  if (!key || !col) {
    logGuardMiss(key, col);
    return { ok: false, status: 503 };
  }
  try {
    const doc = await col.findOne({ email }, { maxTimeMS: 2000 });
    const decision = decideVerify(doc, code, key, now);
    if (!decision.ok) {
      // $inc, not $set: two wrong guesses landing together must both count.
      if (decision.count) await col.updateOne({ email, code_hash: doc?.code_hash }, { $inc: { attempts: 1 }, $set: { updated_at: now } });
      if (decision.reason === "wrong_code") {
        return { ok: false, status: 400, reason: "wrong_code", attemptsLeft: decision.attemptsLeft };
      }
      return { ok: false, status: 410, reason: decision.reason };
    }
    // decideVerify only returns ok when doc is present; this keeps code_hash
    // on the filter below without an assertion.
    if (!doc) return { ok: false, status: 410, reason: "expired" };
    // Filtered on "not yet verified" and the code just judged, so a fresh
    // send racing in between this read and this write cannot have its
    // document stamped verified by a guess made against the old code.
    const result = await col.updateOne(
      { email, code_hash: doc.code_hash, verified_at: { $exists: false }, expires_at: { $gt: now } },
      { $set: { verified_at: now, proof: decision.proof, updated_at: now } },
    );
    if (result.matchedCount !== 1) return { ok: false, status: 410, reason: "expired" };
    return { ok: true, proof: decision.proof, holdMinutes: OTP.holdMs / 60_000 };
  } catch (error) {
    console.error("[otp] verify failed:", error instanceof Error ? error.name : error);
    return { ok: false, status: 503 };
  }
}

export type ConsumeResult = { ok: true; verified_at: Date } | { ok: false; reason: "not_verified" | "error" };

/**
 * Spends a verification. The rule is `canConsume`; the write is filtered on
 * "not yet consumed" so two submissions racing on one proof produce one
 * recipe.
 */
export async function consumeVerification(email: string, proof: string, now = new Date()): Promise<ConsumeResult> {
  const key = apiKey();
  const col = await codes();
  if (!key || !col) {
    logGuardMiss(key, col);
    return { ok: false, reason: "error" };
  }
  try {
    const doc = await col.findOne({ email }, { maxTimeMS: 2000 });
    // The optional-chain check first, so `doc` and `doc.verified_at` are narrowed below.
    if (!doc?.verified_at || !canConsume(doc, email, proof, now)) return { ok: false, reason: "not_verified" };
    const result = await col.updateOne(
      { email, proof, consumed_at: { $exists: false } },
      { $set: { consumed_at: now, updated_at: now } },
    );
    return result.matchedCount === 1 ? { ok: true, verified_at: doc.verified_at } : { ok: false, reason: "not_verified" };
  } catch (error) {
    console.error("[otp] consume failed:", error instanceof Error ? error.name : error);
    return { ok: false, reason: "error" };
  }
}

/** Undoes a consume whose insert then failed, so the retry needs no new code. Unsets, never nulls. */
export async function releaseVerification(email: string, proof: string): Promise<void> {
  const col = await codes();
  if (!col) return;
  try {
    await col.updateOne({ email, proof }, { $unset: { consumed_at: "" }, $set: { updated_at: new Date() } });
  } catch (error) {
    console.error("[otp] release failed:", error instanceof Error ? error.name : error);
  }
}
