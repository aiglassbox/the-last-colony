/**
 * Pins the email OTP rules: the email shape rule, the proof shape, and every
 * decision in otp-rules.ts (send, verify, consume) against a clock.
 *
 *   npx tsx scripts/check-otp.ts
 *
 * Offline: the rules are pure functions over a document and `now`, and the
 * hash key is a parameter, so nothing here needs an env var or the store.
 * `otpDailyMax` is the one import that reaches otp.ts, and therefore the
 * mongodb package — reading a knob opens no connection, exactly as
 * check-submissions.ts already pins `dailyMax` from client.ts.
 */
import {
  canConsume,
  codeMatches,
  decideSend,
  decideVerify,
  hashCode,
  newCode,
  newProof,
  OTP,
  type OtpDoc,
} from "../src/lib/community/otp-rules";
import { otpDailyMax } from "../src/lib/community/otp";
import { normalizeEmail, validateProof, validateSubmission } from "../src/lib/community/schema";

let failed = 0;
function check(name: string, pass: boolean): void {
  if (!pass) {
    failed += 1;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

// --- the email shape rule ----------------------------------------------------
check("email: lowercases and trims", normalizeEmail("  A@B.com ") === "a@b.com");
check("email: needs an @", normalizeEmail("ab.com") === null);
check("email: one @ only", normalizeEmail("a@@b.com") === null);
check("email: needs a dot after the @", normalizeEmail("a@b") === null);
check("email: a dot before the @ is not enough", normalizeEmail("a.b@c") === null);
check("email: no whitespace inside", normalizeEmail("a b@c.com") === null);
check("email: local part required", normalizeEmail("@b.com") === null);
check("email: capped at 120", normalizeEmail(`${"a".repeat(115)}@b.com`) === null);
check("email: 120 exactly is fine", normalizeEmail(`${"a".repeat(114)}@b.com`) !== null);
check("email: non-string is refused", normalizeEmail(42) === null);
check("email: blank is refused", normalizeEmail("   ") === null);

// --- the proof shape -----------------------------------------------------------
check("proof: 64 lowercase hex accepted", validateProof("a".repeat(64)) === "a".repeat(64));
check("proof: uppercase refused", validateProof("A".repeat(64)) === null);
check("proof: short refused", validateProof("abc") === null);
check("proof: non-string refused", validateProof(undefined) === null);

// --- contact is an email now ---------------------------------------------------
const good = {
  display_name: "Aaji Kore",
  state: "Maharashtra",
  belongs_to: "grandmother",
  recipe_name: "Amchi Vada Pav",
  story: "Made every monsoon Sunday since 1962.",
  ingredients: "potatoes, pav, besan, green chillies",
  method: "Boil, mash, spice, dip in besan, fry. Serve in pav.",
  consent: { right_to_share: true, public_display: true },
  contact: "someone@example.com",
};
check("submission: a phone number is not a contact any more", !validateSubmission({ ...good, contact: "9876543210" }).ok);
const lowered = validateSubmission({ ...good, contact: " Aaji@Example.COM " });
check("submission: contact is lowercased", lowered.ok && lowered.value.contact === "aaji@example.com");
check("submission: a plain email still validates", validateSubmission(good).ok);

// --- codes and proofs ----------------------------------------------------------
const KEY = "test-key";
check("code: six digits across 1000 draws, so the zero-padding branch is exercised", Array.from({ length: 1000 }, () => newCode()).every((c) => /^\d{6}$/.test(c)));
check("code: the hash is keyed", hashCode("123456", "k1") !== hashCode("123456", "k2"));
check("code: matches its own hash", codeMatches("123456", hashCode("123456", KEY), KEY));
check("code: rejects another code", !codeMatches("123457", hashCode("123456", KEY), KEY));
check("code: rejects a malformed hash without throwing", !codeMatches("123456", "zz", KEY));
check("code: rejects a hash with trailing garbage", !codeMatches("123456", `${hashCode("123456", KEY)}zz`, KEY));
check("proof: newProof is 64 hex", /^[0-9a-f]{64}$/.test(newProof()));

// --- send: cooldown, cap, window ---------------------------------------------------
const T0 = new Date("2026-09-08T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const first = decideSend(null, "a@b.com", "111111", KEY, T0);
check("send: the first send is allowed", first.ok);
if (!first.ok) throw new Error("the first send must be allowed");
const d1 = first.doc;
check("send: first send opens a window", d1.sends === 1 && d1.window_start.getTime() === T0.getTime());
check("send: expiry is five minutes out", d1.expires_at.getTime() === T0.getTime() + OTP.lifeMs);
check("send: the stored hash is the code's", codeMatches("111111", d1.code_hash, KEY));
check("send: a send carries no verification", !("verified_at" in d1) && !("proof" in d1) && !("consumed_at" in d1));
check("send: the document carries the email, and last_sent_at/updated_at are now", d1.email === "a@b.com" && d1.last_sent_at.getTime() === T0.getTime() && d1.updated_at.getTime() === T0.getTime());

const tooSoon = decideSend(d1, "a@b.com", "222222", KEY, at(179));
check("send: inside the cooldown is refused with the seconds left", !tooSoon.ok && tooSoon.reason === "cooldown" && tooSoon.retryAfter === 1);

const second = decideSend({ ...d1, attempts: 2, verified_at: at(10), proof: "p" }, "a@b.com", "222222", KEY, at(180));
check("send: a send at the cooldown is allowed", second.ok);
if (!second.ok) throw new Error("a send at the cooldown must be allowed");
const d2 = second.doc;
check("send: at the cooldown a second send is counted in the same window", d2.sends === 2 && d2.window_start.getTime() === T0.getTime());
check("send: a new send resets attempts and carries a new hash", d2.attempts === 0 && d2.code_hash !== d1.code_hash);
check("send: a new send wipes a prior verification", !("verified_at" in d2) && !("proof" in d2));

// With 180 s between sends only two fit in 300 s, so the cap is reached by
// fabricating a document rather than by a sequence a person could produce.
const capped: OtpDoc = { ...d2, sends: OTP.maxSends, last_sent_at: T0 };
const fourth = decideSend(capped, "a@b.com", "444444", KEY, at(250));
check("send: the cap refuses with the seconds until the window resets", !fourth.ok && fourth.reason === "cap" && fourth.retryAfter === 50);
const fresh = decideSend(capped, "a@b.com", "444444", KEY, at(300));
check("send: a closed window starts a new one", fresh.ok && fresh.doc.sends === 1 && fresh.doc.window_start.getTime() === at(300).getTime());

// --- verify: expiry, strikes, spent codes ----------------------------------------
const none = decideVerify(null, "111111", KEY, T0);
check("verify: no document is expired and not counted", !none.ok && none.reason === "expired" && !none.count);
const late = decideVerify(d1, "111111", KEY, at(300));
check("verify: at expiry the right code is expired", !late.ok && late.reason === "expired" && !late.count);
const okv = decideVerify(d1, "111111", KEY, at(299));
check("verify: the right code a second before expiry verifies with a proof", okv.ok && /^[0-9a-f]{64}$/.test(okv.proof));
const wrong1 = decideVerify(d1, "999999", KEY, at(10));
check("verify: a wrong code counts and leaves two", !wrong1.ok && wrong1.reason === "wrong_code" && wrong1.attemptsLeft === 2 && wrong1.count);
const wrong2 = decideVerify({ ...d1, attempts: 1 }, "999999", KEY, at(10));
check("verify: a second wrong leaves one", !wrong2.ok && wrong2.reason === "wrong_code" && wrong2.attemptsLeft === 1 && wrong2.count);
const wrong3 = decideVerify({ ...d1, attempts: 2 }, "999999", KEY, at(10));
check("verify: the third wrong locks and is counted", !wrong3.ok && wrong3.reason === "locked" && wrong3.attemptsLeft === 0 && wrong3.count);
const locked = decideVerify({ ...d1, attempts: 3 }, "111111", KEY, at(10));
check("verify: a locked code refuses even the right one, uncounted", !locked.ok && locked.reason === "locked" && !locked.count);
const spent = decideVerify({ ...d1, verified_at: at(5), proof: "p" }, "111111", KEY, at(10));
check("verify: a spent code is expired", !spent.ok && spent.reason === "expired" && !spent.count);

// --- consume: right email, right proof, inside the hold, once ----------------------
const proof = newProof();
const verified: OtpDoc = { ...d1, verified_at: at(60), proof };
check("consume: right email and proof inside the hold", canConsume(verified, "a@b.com", proof, at(60 + OTP.holdMs / 1000)));
check("consume: a second past the hold", !canConsume(verified, "a@b.com", proof, at(61 + OTP.holdMs / 1000)));
check("consume: wrong proof", !canConsume(verified, "a@b.com", newProof(), at(70)));
check("consume: wrong email", !canConsume(verified, "b@b.com", proof, at(70)));
check("consume: never verified", !canConsume(d1, "a@b.com", proof, at(70)));
check("consume: only once", !canConsume({ ...verified, consumed_at: at(65) }, "a@b.com", proof, at(70)));
check("consume: a proof of another length does not throw", !canConsume(verified, "a@b.com", "short", at(70)));
check("consume: no document", !canConsume(null, "a@b.com", proof, at(70)));

// --- the day's ceiling, the same knob conventions as SUBMISSION_DAILY_MAX ------
// It bounds the blast radius on Resend's allowance rather than limiting a
// person, so the default sits under the provider's own hundred a day and our
// refusal comes first.
delete process.env.OTP_DAILY_MAX;
check("otpDailyMax: unset means 90", otpDailyMax() === 90);
check("otpDailyMax: the default leaves headroom under Resend's 100 a day", otpDailyMax() < 100);
process.env.OTP_DAILY_MAX = "0";
check("otpDailyMax: 0 refuses every send", otpDailyMax() === 0);
process.env.OTP_DAILY_MAX = "  250 ";
check("otpDailyMax: trimmed number", otpDailyMax() === 250);
process.env.OTP_DAILY_MAX = "abc";
check("otpDailyMax: garbage means 90", otpDailyMax() === 90);
process.env.OTP_DAILY_MAX = "-5";
check("otpDailyMax: negative means 90", otpDailyMax() === 90);
delete process.env.OTP_DAILY_MAX;

if (failed > 0) {
  console.error(`\ncheck-otp: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-otp: all OTP checks pass");
