/**
 * Pins the pantry's door and, from Task 3, its corpus-candidate export.
 *
 *   npx tsx scripts/check-pantry.ts
 *
 * Model-free and offline. The token maths is pinned against its own HMAC
 * derivation on purpose: a change there invalidates every live session on
 * both doors, and should show up here before it shows up in a browser.
 */
import { createHmac } from "node:crypto";

import { kitchen, pantry } from "../src/lib/dash/auth";
import { makeGate, passwordMatches } from "../src/lib/dash/gate";

let failed = 0;
function check(name: string, pass: boolean): void {
  if (!pass) {
    failed += 1;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

// --- the door: one factory, any number of instances ------------------------
process.env.CHECK_GATE_PASSWORD = "  swordfish  ";
delete process.env.CHECK_GATE_SECRET;
const gate = makeGate("check", "CHECK_GATE_PASSWORD", "CHECK_GATE_SECRET");
const other = makeGate("other", "CHECK_GATE_PASSWORD", "CHECK_GATE_SECRET");

check("cookie is namespaced by door", gate.cookie === "kc_check" && other.cookie === "kc_other");
check("password is trimmed", gate.password() === "swordfish");
check("unset password means no door", makeGate("x", "CHECK_GATE_UNSET", "CHECK_GATE_UNSET_S").password() === null);
process.env.CHECK_GATE_BLANK = "   ";
check("blank password means no door", makeGate("x", "CHECK_GATE_BLANK", "CHECK_GATE_UNSET_S").password() === null);

const token = gate.issueToken("swordfish");
check("issued token is valid for its door", gate.tokenValid(token.value, "swordfish"));
check("token carries a 12-hour max-age", token.maxAge === 12 * 60 * 60);
check("token is invalid under another door's derivation", !other.tokenValid(token.value, "swordfish"));
check("token is invalid under another password", !gate.tokenValid(token.value, "pike"));
check("missing token is invalid", !gate.tokenValid(undefined, "swordfish"));
check("malformed token is invalid", !gate.tokenValid("no-dot-here", "swordfish") && !gate.tokenValid("123.", "swordfish"));
check(
  "tampered signature is invalid",
  !gate.tokenValid(token.value.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "swordfish"),
);

// The derivation, restated: sha256 HMAC over the expiry, keyed "<door>:<password>".
const sign = (expiry: string) => createHmac("sha256", "check:swordfish").update(expiry).digest("hex");
check("expired token is invalid even when correctly signed", !gate.tokenValid(`1.${sign("1")}`, "swordfish"));
const future = String(Date.now() + 60_000);
check("hand-signed future token is valid (derivation pinned)", gate.tokenValid(`${future}.${sign(future)}`, "swordfish"));
process.env.CHECK_GATE_SECRET = "pepper";
check(
  "a secret var replaces the derived key",
  !gate.tokenValid(`${future}.${sign(future)}`, "swordfish") && gate.tokenValid(gate.issueToken("swordfish").value, "swordfish"),
);
delete process.env.CHECK_GATE_SECRET;

// --- the two real doors: env-var names are literals tsc cannot check --------
// A typo in one of these strings reads an unset variable, and the door then
// fail-closes to 404 in production without a single type error.
process.env.KITCHEN_PASSWORD = "k-live";
process.env.ADMIN_PASSWORD = "p-live";
check("kitchen door is kc_kitchen and reads KITCHEN_PASSWORD", kitchen.cookie === "kc_kitchen" && kitchen.password() === "k-live");
check("pantry door is kc_pantry and reads ADMIN_PASSWORD", pantry.cookie === "kc_pantry" && pantry.password() === "p-live");
check("a kitchen session is not a pantry session", !pantry.tokenValid(kitchen.issueToken("k-live").value, "k-live"));

check("passwordMatches: equal", passwordMatches("swordfish", "swordfish"));
check("passwordMatches: different length", !passwordMatches("sword", "swordfish"));
check("passwordMatches: same length, different", !passwordMatches("swordfisH", "swordfish"));
check("passwordMatches: non-string", !passwordMatches(123, "swordfish") && !passwordMatches(undefined, "swordfish"));

if (failed > 0) {
  console.error(`\ncheck-pantry: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-pantry: all pantry checks pass");
