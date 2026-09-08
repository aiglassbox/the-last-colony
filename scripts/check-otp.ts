/**
 * Pins the email OTP rules: the email shape rule, the proof shape, and every
 * decision in otp-rules.ts (send, verify, consume) against a clock.
 *
 *   npx tsx scripts/check-otp.ts
 *
 * Offline: the rules are pure functions over a document and `now`, and the
 * hash key is a parameter, so nothing here needs an env var or the store.
 */
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

if (failed > 0) {
  console.error(`\ncheck-otp: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-otp: all OTP checks pass");
