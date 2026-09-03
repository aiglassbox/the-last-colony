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

import { toCorpusCandidate } from "../src/lib/community/candidate";
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

// --- the corpus candidate: copy-shape work for a human, never a promotion ----
const green = {
  id: "6a98996d7608d2116cde5615",
  status: "green" as const,
  created_at: new Date("2026-09-02T21:47:24.958Z"),
  updated_at: new Date("2026-09-02T21:47:30.000Z"),
  mode: "image" as const,
  submission: {
    display_name: "Aaji Kore",
    state: "Maharashtra",
    city: "Mumbai",
    belongs_to: "grandmother",
    recipe_name: "Amchi Vada Pav",
    story: "Monsoon Sundays.",
    ingredients: "- potatoes\n- pav\n\n- besan",
    method: "1. Boil.\n2. Mash.\n3) Fry.",
    language: "mr",
    consent: { right_to_share: true, public_display: true },
    contact: "secret@example.com",
    photo: { data: "aGVsbG8=", mime: "image/jpeg", bytes: 5 },
  },
  geo: { country: "IN", region: "MH", city: "Mumbai", timezone: "Asia/Kolkata" },
  verdict: { card: "GREEN" as const, reasons: [], model: "gemini-3.1-flash-lite", at: new Date("2026-09-02T21:47:29.000Z") },
  dish: { tag: "vada-pav", aliases: ["vada pav", "wada pav"] },
};
const candidate = toCorpusCandidate(green);
const json = JSON.stringify(candidate);

check("candidate: never ATTESTED", candidate.provenance_class === "MODERN_DISH" && candidate.tier === "modern");
check(
  "candidate: no original-language text (rule 2)",
  candidate.original_text === null && candidate.transliteration === null && candidate.translation === null,
);
check("candidate: unverified seed, nobody has checked it", candidate.verification.status === "unverified_seed" && candidate.verification.checked_by === null && candidate.verification.checked_on === null);
check("candidate: contact never leaves the pantry", !json.includes("contact") && !json.includes("secret@example.com"));
check("candidate: photo stays in the store", !json.includes("aGVsbG8=") && !json.includes("photo"));
check(
  "candidate: ingredients one per line, bullets stripped, blanks dropped",
  candidate.ingredients.map((i) => i.name).join("|") === "potatoes|pav|besan",
);
check("candidate: method steps unnumbered", candidate.method_reconstructed.join("|") === "Boil.|Mash.|Fry.");
check("candidate: tag drives id and slug", candidate.id === "community-vada-pav-de5615" && candidate.slug === "vada-pav-community-de5615");
check("candidate: aliases and region carried", candidate.aliases.length === 2 && candidate.region === "Maharashtra");
check("candidate: attribution in citation, never in locus", candidate.source.locus === null && (candidate.source.citation ?? "").includes("Aaji Kore"));
check(
  "candidate: community block carries story, mode and the store id",
  candidate.community.story === "Monsoon Sundays." && candidate.community.mode === "image" && candidate.community.submission_id === green.id,
);
check("candidate: untagged doc still exports", toCorpusCandidate({ ...green, dish: undefined }).slug === "untagged-community-de5615");

if (failed > 0) {
  console.error(`\ncheck-pantry: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-pantry: all pantry checks pass");
