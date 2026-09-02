/**
 * Pins the community-submission validation and normalization rules.
 *
 *   npx tsx scripts/check-submissions.ts
 *
 * Model-free and offline, so it runs in `npm run check`. The API route is a
 * trust boundary: the UI's required/optional split is convenience, this is
 * the enforcement.
 */
import { validateSubmission, PHOTO_MAX_BYTES } from "../src/lib/community/schema";

let failed = 0;
function check(name: string, pass: boolean): void {
  if (!pass) {
    failed += 1;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

const good = {
  display_name: "Aaji Kore",
  state: "Maharashtra",
  belongs_to: "grandmother",
  recipe_name: "Amchi Vada Pav",
  story: "Made every monsoon Sunday since 1962.",
  ingredients: "potatoes, pav, besan, green chillies",
  method: "Boil, mash, spice, dip in besan, fry. Serve in pav.",
  language: "mr",
  consent: { right_to_share: true, public_display: true },
  contact: "someone@example.com",
};

// --- shape ---------------------------------------------------------------
check("accepts a complete manual submission", validateSubmission(good).ok);
check("rejects non-object", !validateSubmission("hi").ok);
check("rejects null", !validateSubmission(null).ok);

// --- required fields -----------------------------------------------------
for (const field of [
  "display_name",
  "state",
  "belongs_to",
  "recipe_name",
  "story",
  "ingredients",
  "method",
  "language",
  "contact",
] as const) {
  const broken: Record<string, unknown> = { ...good };
  delete broken[field];
  check(`rejects missing ${field}`, !validateSubmission(broken).ok);
  check(`rejects blank ${field}`, !validateSubmission({ ...good, [field]: "   " }).ok);
}

// --- consent: both boxes, server-enforced --------------------------------
check(
  "rejects consent.right_to_share=false",
  !validateSubmission({ ...good, consent: { right_to_share: false, public_display: true } }).ok,
);
check(
  "rejects consent.public_display=false",
  !validateSubmission({ ...good, consent: { right_to_share: true, public_display: false } }).ok,
);
check("rejects missing consent", !validateSubmission({ ...good, consent: undefined }).ok);

// --- optional fields stay optional ---------------------------------------
check("city is optional", validateSubmission({ ...good, city: "Mumbai" }).ok);
check("belongs_to_other is optional", validateSubmission({ ...good, belongs_to_other: "Badi Amma" }).ok);

// --- caps ----------------------------------------------------------------
check("caps story at 4000", !validateSubmission({ ...good, story: "x".repeat(4001) }).ok);
check("caps method at 8000", !validateSubmission({ ...good, method: "x".repeat(8001) }).ok);
check("caps display_name at 80", !validateSubmission({ ...good, display_name: "x".repeat(81) }).ok);

// --- photo ---------------------------------------------------------------
const photoOk = { data: "aGVsbG8=", mime: "image/jpeg" }; // "hello", 5 bytes
// 4 base64 chars decode to 3 bytes; one group past the cap is over it.
const oversized = "AAAA".repeat(Math.ceil(PHOTO_MAX_BYTES / 3) + 1);
check("photo optional and accepted", validateSubmission({ ...good, photo: photoOk }).ok);
check("photo: null is treated as absent", validateSubmission({ ...good, photo: null }).ok);
const measured = validateSubmission({ ...good, photo: photoOk });
check("photo bytes are measured from data", measured.ok && measured.value.photo?.bytes === 5);
check(
  "rejects photo over cap",
  !validateSubmission({ ...good, photo: { ...photoOk, data: oversized } }).ok,
);
check(
  "ignores a client-claimed size under the cap",
  !validateSubmission({ ...good, photo: { ...photoOk, data: oversized, bytes: 1 } }).ok,
);
check(
  "rejects non-image mime",
  !validateSubmission({ ...good, photo: { ...photoOk, mime: "application/pdf" } }).ok,
);

// --- verbatim: validation must not mutate what was submitted --------------
const withSpaces = validateSubmission({ ...good, recipe_name: "  Amchi Vada Pav  " });
check(
  "trims field edges only, keeps content verbatim",
  withSpaces.ok && withSpaces.value.recipe_name === "Amchi Vada Pav",
);

if (failed > 0) {
  console.error(`\ncheck-submissions: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-submissions: all validation checks pass");
