import type { Collection } from "mongodb";

import { RATE_LIMIT } from "@/lib/rate-limit";

import { communityDb } from "./client";
import { otpEmail } from "./otp-email";
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
/**
 * The day's send counters — one document per UTC day, `_id` the day itself,
 * and one per UTC day per caller key beside it.
 *
 * Its own collection, not a row in `otp_codes`: that one is unique on `email`
 * and Mongo reads a missing field as null, so only one address-less document
 * could ever exist there; and its TTL runs from `updated_at` an hour after the
 * last touch, which would delete a day's count mid-morning and hand the day a
 * second full allowance.
 */
export const OTP_DAILY = "otp_daily";

/**
 * `_id` is "YYYY-MM-DD" UTC for the shared counter and "YYYY-MM-DD:<caller>"
 * for one caller's, so either is found without a query. The day string is a
 * fixed ten characters and carries no colon, so the two shapes cannot collide,
 * and the collection's TTL on `updated_at` housekeeps both.
 */
interface DailyDoc {
  _id: string;
  /** Codes handed to Resend today; a send that never left is given back. */
  sends: number;
  updated_at: Date;
}

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

async function days(): Promise<Collection<DailyDoc> | null> {
  const db = await communityDb();
  return db ? db.collection<DailyDoc>(OTP_DAILY) : null;
}

/** The UTC day, the same boundary `insertSubmission` counts against.
 *  `toISOString` is UTC by definition, so this is `Date.UTC(y, m, d)` spelt
 *  as the key it becomes. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Blast-radius ceiling on codes sent per UTC day across everybody — not a
 * per-person limit, which is the cooldown and the cap in `otp-rules.ts`. It
 * sits under Resend's own hundred a day so our refusal comes first, with
 * the mailroom's 25 (`MAILROOM_DAILY_MAX`) beside it, the two together at 95. Read per call so a test can set it.
 * `0` refuses every send; unset or unparseable means the default.
 */
export function otpDailyMax(): number {
  const raw = process.env.OTP_DAILY_MAX?.trim();
  const n = raw ? Number(raw) : 70;
  return Number.isFinite(n) && n >= 0 ? n : 70;
}

/**
 * Codes sent per UTC day per caller — the dimension the ceiling above lacks.
 *
 * `otpDailyMax` is global by design, and on its own it was spendable by a
 * single host. Both per-person bounds live in `decideSend`, inside
 * `if (existing)` (otp-rules.ts:85), and `existing` is `findOne({ email })` on
 * the address in the request body — so a caller naming a fresh address every
 * time meets neither of them, not once. The route's own three-per-window
 * ceiling is 864 accepted sends a day, an order above the ninety the day
 * allows. Ninety small POSTs therefore closed verification, and through the
 * proof requirement every recipe submission, for every visitor until midnight.
 *
 * This is the lower of the two ceilings and the one an ordinary submitter
 * never meets: a person verifies one address, and the three-minute cooldown
 * already holds them to two or three codes. Conventions follow `otpDailyMax`
 * exactly — read per call so a test can set it, `0` refuses every send, unset
 * or unparseable means the default.
 *
 * ponytail: the key is `clientKey`, which rate-limit.ts documents as
 * spoofable. This raises the cost of closing the day from ninety requests to
 * ninety distinct source addresses; it does not make it free. A challenge on
 * the send route is the only control that makes a fresh address cost the
 * caller anything.
 */
export function otpDailyPerCallerMax(): number {
  const raw = process.env.OTP_DAILY_PER_CALLER_MAX?.trim();
  const n = raw ? Number(raw) : 5;
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/**
 * Seconds until the counters' day rolls over, for the `retry-after` on a
 * per-caller refusal. Day + 1 in UTC rather than +86_400_000, so it lands on
 * the next midnight and not an offset from this instant. At least one, so a
 * refusal never tells a caller to retry now.
 */
export function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * The day's allowance for callers that cannot be told apart.
 *
 * A pool of unknown callers is not one caller and must not be held to one
 * caller's allowance — the rule `checkRate` already applies to this same key.
 * With no forwarding header every visitor arrives as `unidentified`, and five
 * a day between all of them would close the form at the day's fifth send:
 * strictly worse than the hole the per-caller ceiling was added to close.
 *
 * But the pool cannot be exempt either, and this is the part worth being
 * careful about: `clientKey` returns the caller's own header value verbatim,
 * so anyone may arrive claiming to be the pool. Skipping the daily ceiling for
 * the pool would therefore have handed every caller a one-header bypass of it.
 * So the pool is counted like anybody else, just against a pool-sized figure —
 * and that figure is deliberately short of `otpDailyMax`, which is what makes
 * it a ceiling rather than an exemption: callers we *can* tell apart keep a
 * quarter of the day whatever the pool does with its three.
 *
 * Derived rather than configured, because a third knob whose only sane values
 * are "a bit under OTP_DAILY_MAX" is a knob nobody should have to set. The
 * cost is stated plainly: a deployment whose proxy forwards nothing gives its
 * real visitors three quarters of the day rather than all of it.
 */
export function otpDailyPoolMax(): number {
  return Math.floor((otpDailyMax() * 3) / 4);
}

/** The per-caller counter's `_id`: the day, then the caller, never colliding
 *  with the shared counter's own bare-day `_id`. */
export function dailySlot(now: Date, callerKey: string): string {
  return `${utcDay(now)}:${callerKey}`;
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
      // Both parts: the HTML for every client that renders it, the text for
      // the ones that do not. Built in `otp-email.ts`, pinned by check-otp.
      // The sender and recipient are written last, so nothing the builder
      // returns can ever override them.
      body: JSON.stringify({ ...otpEmail(code), from: FROM, to }),
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
  | { ok: false; status: 429; reason: "cooldown" | "cap" | "daily"; retryAfter: number }
  | { ok: false; status: 503 };

/**
 * Writes the new code first and sends second, and rolls the write back if
 * the mail never left: a person must not be charged a send, or start a
 * cooldown, for an email they did not get. Both day counters are spent and
 * rolled back on exactly the same two paths, for the same reason.
 *
 * `callerKey` is the limiter's view of who is asking (`clientKey`), and it
 * carries the only budget dimension the caller does not choose outright. The
 * route supplies it rather than this file reading the request, so the key the
 * day is counted against is the same string the window was counted against.
 *
 * ponytail: read-decide-replace is not atomic, so two sends landing together
 * can both pass the cooldown; the per-IP limiter is the real ceiling there.
 * And if the rollback write itself throws, the outer catch returns the
 * failure with the new send count and cooldown still in place — so the
 * person is charged a cooldown for mail they never received, the one thing
 * this write-then-send ordering exists to prevent.
 */
export async function sendCode(email: string, callerKey: string, now = new Date()): Promise<SendResult> {
  const key = apiKey();
  const col = await codes();
  const daily = await days();
  if (!key || !col || !daily) {
    logGuardMiss(key, col);
    return { ok: false, status: 503 };
  }
  try {
    const existing = await col.findOne({ email }, { maxTimeMS: 2000 });
    const code = newCode();
    const decision = decideSend(existing, email, code, key, now);
    if (!decision.ok) return { ok: false, status: 429, reason: decision.reason, retryAfter: decision.retryAfter };

    // The day's budget is spent here: after the per-address decision, so a
    // cooldown or cap refusal costs nothing from it, and before the code is
    // written, so an exhausted day charges nobody a cooldown for mail that
    // was never going to go out. $inc and read back the value the write
    // produced, so two sends racing for the last slot get two different
    // numbers and only one of them is under the ceiling. A throw here lands
    // in the outer catch and refuses: an uncountable day sends nothing —
    // including the one case that is not a real fault, two sends racing to
    // create the day's very first document, where one gets a duplicate key on
    // `_id` and is told to try again a moment later.
    const day = utcDay(now);
    const max = otpDailyMax();
    const today = await daily.findOneAndUpdate(
      { _id: day },
      { $inc: { sends: 1 }, $set: { updated_at: now } },
      { upsert: true, returnDocument: "after" },
    );
    if (!today) {
      console.error("[otp] daily counter unreadable; refusing send");
      return { ok: false, status: 503 };
    }
    if (today.sends > max) {
      // Its own line, so an exhausted day greps apart from a Resend outage.
      console.error(`[otp] daily ceiling reached (${today.sends}/${max}); refusing send`);
      return { ok: false, status: 503 };
    }

    // The second dimension, and the one that bounds a principal: the count
    // above is global, so one host naming ninety fresh addresses could take
    // the whole day and close the form for everybody. See
    // `otpDailyPerCallerMax` for why neither per-address bound catches that.
    //
    // Spent after the shared slot, not before, so an exhausted day creates no
    // per-caller document: the collection then grows by at most the day's own
    // allowance however many keys turn up, rather than once per request from a
    // caller rotating the header. Same `$inc`-and-read-back as above, so two
    // sends racing for this caller's last slot get two different numbers —
    // and the same duplicate-key race on a caller's first send of the day,
    // whose loser throws to the outer catch with the shared slot already
    // spent. One slot of ninety, and it buys a caller nothing: a key racing
    // itself is still held to five, and a key it has not used yet would have
    // spent that slot legitimately anyway.
    // The pool is counted like any other caller, against a pool-sized figure;
    // see `otpDailyPoolMax` for why it is not exempt.
    const slot = dailySlot(now, callerKey);
    const pooled = callerKey === RATE_LIMIT.sharedKey;
    const callerMax = pooled ? otpDailyPoolMax() : otpDailyPerCallerMax();
    const mine = await daily.findOneAndUpdate(
      { _id: slot },
      { $inc: { sends: 1 }, $set: { updated_at: now } },
      { upsert: true, returnDocument: "after" },
    );
    if (!mine || mine.sends > callerMax) {
      // The shared slot goes back first: this send is refused, so it must not
      // count against everybody else's day — the same rule the cooldown and
      // the cap already get.
      await daily.updateOne({ _id: day }, { $inc: { sends: -1 }, $set: { updated_at: now } });
      if (!mine) {
        console.error("[otp] per-caller daily counter unreadable; refusing send");
        return { ok: false, status: 503 };
      }
      // The count, the ceiling and which of the two it was — never the key,
      // which identifies the caller the way the address identifies the person
      // and goes the same way.
      console.error(
        `[otp] ${pooled ? "pool" : "per-caller"} daily ceiling reached (${mine.sends}/${callerMax}); refusing send`,
      );
      return { ok: false, status: 429, reason: "daily", retryAfter: secondsToUtcMidnight(now) };
    }

    await col.replaceOne({ email }, decision.doc, { upsert: true });
    if (!(await deliver(email, code, key))) {
      if (existing) await col.replaceOne({ email }, existing);
      else await col.deleteOne({ email });
      // Given back with the code, and for the same reason: no mail left. Both
      // counters, because both were spent, in one round trip.
      await daily.updateMany({ _id: { $in: [day, slot] } }, { $inc: { sends: -1 }, $set: { updated_at: now } });
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
