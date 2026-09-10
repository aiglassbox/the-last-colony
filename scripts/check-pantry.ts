/**
 * Pins the pantry's door and, from Task 3, its corpus-candidate export.
 *
 *   npx tsx scripts/check-pantry.ts
 *
 * Model-free and offline, and part of `npm run check`. The token maths is
 * pinned against its own HMAC derivation on purpose: a change there
 * invalidates every live session on both doors, and should show up here
 * before it shows up in a browser.
 *
 * A second section below drives the publish gate against Atlas end to end,
 * but only opt-in — set CHECK_LIVE=1 and load the store's credentials — so
 * this script and `npm run check` stay offline by default with no Atlas call:
 *
 *   CHECK_LIVE=1 npx tsx --env-file=.env scripts/check-pantry.ts
 */
import { ObjectId } from "mongodb";
import { createHmac } from "node:crypto";

import { toCorpusCandidate } from "../src/lib/community/candidate";
import {
  applyVerdict,
  communityDb,
  getSubmission,
  insertSubmission,
  overrideVerdict,
  publishSubmission,
  SUBMISSIONS,
  unpublishSubmission,
} from "../src/lib/community/client";
import { kitchen, pantry } from "../src/lib/dash/auth";
import { makeGate, passwordMatches } from "../src/lib/dash/gate";
import type { Verdict } from "../src/lib/community/pipeline";
import type { SubmissionInput } from "../src/lib/community/schema";
import { NO_GEO } from "../src/lib/events/geo";

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

// --- the live section: the publish gate, driven against Atlas end to end ---
// Opt-in only. `npm run check` runs this script with neither CHECK_LIVE nor
// --env-file, so the opt-in check below is false and communityDb() is never
// even called — zero Atlas calls in the offline gate, by construction rather
// than by hoping the store happens to be unreachable in CI.
async function checkPublishGateLive(): Promise<void> {
  if (process.env.CHECK_LIVE !== "1") {
    console.log("  skip live pantry checks (set CHECK_LIVE=1 and pass --env-file=.env to run them)");
    return;
  }
  const db = await communityDb();
  if (!db) {
    console.error(
      "check-pantry: CHECK_LIVE=1 but ATLAS_URL/ATLAS_USER/ATLAS_PASSWORD are unset or the store is unreachable — skipping live checks",
    );
    return;
  }

  // Read-only: green documents with no dish tag can never be matched by
  // Phase 4's serving path. Task 2 stops new ones being published; this
  // surfaces any that already exist rather than leaving them a mystery.
  const unmatchable = await db
    .collection(SUBMISSIONS)
    .find(
      { status: "green", $or: [{ "dish.tag": { $exists: false } }, { "dish.tag": "" }] },
      { projection: { _id: 1 } },
    )
    .toArray();
  console.log(
    unmatchable.length
      ? `  unmatchable (green, no dish tag): ${unmatchable.map((d) => String(d._id)).join(", ")}`
      : "  unmatchable (green, no dish tag): none",
  );

  // The publish gate. Each of these is an invariant the store owns, not the
  // UI: a button can be removed by a careless edit, a store filter cannot.
  const scratchInput: SubmissionInput = {
    display_name: "check-pantry-scratch",
    state: "Maharashtra",
    belongs_to: "grandmother",
    recipe_name: "Scratch Dish",
    story: "A scratch document created by check-pantry.ts's live block and deleted at the end of it.",
    ingredients: "test",
    method: "test",
    consent: { right_to_share: true, public_display: true },
    contact: "scratch@example.com",
  };
  const scratch = await insertSubmission({ mode: "manual", submission: scratchInput, geo: NO_GEO });
  if (!scratch) {
    failed += 1;
    console.error("  FAIL live: could not insert the scratch submission (daily ceiling, or the store refused the write)");
    return;
  }
  try {
    check("live: publish refuses a pending document", (await publishSubmission(scratch)) === "not_green");
    await applyVerdict(scratch, { card: "GREEN", reasons: [], dish_tag: "", aliases: [], language: "en", model: "check" });
    check("live: publish refuses a green document with no dish tag", (await publishSubmission(scratch)) === "no_tag");
    await applyVerdict(scratch, { card: "GREEN", reasons: [], dish_tag: "scratch-dish", aliases: [], language: "en", model: "check" });
    check("live: publish accepts a tagged green document", (await publishSubmission(scratch)) === "ok");
    const greenVerdict: Verdict = { card: "GREEN", reasons: [], dish_tag: "scratch-dish-2", aliases: [], language: "en", model: "check" };
    check("live: a published document refuses a new verdict", (await applyVerdict(scratch, greenVerdict)) === false);
    await overrideVerdict(scratch, "RED");
    const afterRed = await getSubmission(scratch);
    check("live: marking red unpublishes", afterRed !== null && afterRed.published_at === undefined);
    check("live: unpublish removes the field rather than nulling it", afterRed !== null && !("published_at" in afterRed));
    check("live: publish refuses a red document", (await publishSubmission(scratch)) === "not_green");

    // The takedown driven directly, rather than as a side effect of an
    // override: the Published view's own button goes through this path.
    await overrideVerdict(scratch, "GREEN");
    check("live: a GREEN override makes it publishable again", (await publishSubmission(scratch)) === "ok");
    check("live: unpublish reports ok", (await unpublishSubmission(scratch)) === "ok");
    const afterUnpublish = await getSubmission(scratch);
    check(
      "live: unpublish leaves no published_at behind",
      afterUnpublish !== null && !("published_at" in afterUnpublish),
    );
    // A fresh ObjectId matches nothing, so this is a read-shaped no-op: it
    // proves a stale id is told apart from an outage without writing anything.
    check(
      "live: unpublish on an absent id is not_found",
      (await unpublishSubmission(new ObjectId().toHexString())) === "not_found",
    );
  } finally {
    // Store-write safety: this block creates exactly one document, and it
    // must not survive the run — including when a check above throws. Never
    // touch anything but the id this block just inserted.
    await db.collection(SUBMISSIONS).deleteOne({ _id: new ObjectId(scratch) });
  }
}

(async () => {
  await checkPublishGateLive();

  if (failed > 0) {
    console.error(`\ncheck-pantry: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\ncheck-pantry: all pantry checks pass");
  // A live run leaves the pooled Mongo client connected, which holds the event
  // loop open long after the summary prints. Exit explicitly, the way
  // community-index.ts does, so the script is runnable from a shell and CI.
  process.exit(0);
})();
