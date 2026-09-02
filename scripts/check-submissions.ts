/**
 * Pins the community-submission validation and normalization rules.
 *
 *   npx tsx scripts/check-submissions.ts
 *
 * Model-free and offline, so it runs in `npm run check`. The API route is a
 * trust boundary: the UI's required/optional split is convenience, this is
 * the enforcement.
 */
import {
  validateSubmission,
  validateExtracted,
  validatePhoto,
  PHOTO_MAX_BYTES,
  MAX_BODY_BYTES,
} from "../src/lib/community/schema";
import { normalizeDish } from "../src/lib/community/normalize";
import { atlasUri } from "../src/lib/community/client";
import { parseExtraction } from "../src/lib/community/extract";

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

// --- normalization (Phase 4 matches against these; pin them now) ----------
check("lowercases", normalizeDish("Vada Pav") === "vada pav");
check("strips diacritics", normalizeDish("Vilepī") === "vilepi");
check("collapses punctuation", normalizeDish("amma's vada-pav!") === "amma s vada pav");
check("collapses whitespace", normalizeDish("  vada   pav  ") === "vada pav");
check("keeps Devanagari intact", normalizeDish("वडा पाव") === "वडा पाव");
check("keeps Tamil intact", normalizeDish("பொங்கல்") === "பொங்கல்");
check("keeps Kannada intact", normalizeDish("ಬಿಸಿ ಬೇಳೆ") === "ಬಿಸಿ ಬೇಳೆ");
check("empty stays empty", normalizeDish("   ") === "");

// --- Atlas URI shapes (client.ts must accept every form Atlas hands out) ----
check("atlasUri: null when any var missing", atlasUri("h.mongodb.net", "u", undefined) === null);
check(
  "atlasUri: bare host becomes SRV with defaults",
  atlasUri("cluster0.abc.mongodb.net", "u", "p") ===
    "mongodb+srv://u:p@cluster0.abc.mongodb.net/?retryWrites=true&w=majority",
);
check(
  "atlasUri: host with port is standard, not SRV",
  atlasUri("cluster0.abc.mongodb.net:27017", "u", "p") ===
    "mongodb://u:p@cluster0.abc.mongodb.net:27017/?retryWrites=true&w=majority",
);
check(
  "atlasUri: SRV string keeps its query and replaces embedded creds",
  atlasUri("mongodb+srv://old:creds@c.abc.mongodb.net/?appName=X", "u", "p@ss") ===
    "mongodb+srv://u:p%40ss@c.abc.mongodb.net/?appName=X&retryWrites=true&w=majority",
);
check(
  "atlasUri: standard multi-host string keeps ssl/replicaSet/authSource",
  atlasUri("mongodb://a.net:27017,b.net:27017/?ssl=true&replicaSet=atlas-x&authSource=admin", "u", "p") ===
    "mongodb://u:p@a.net:27017,b.net:27017/?ssl=true&replicaSet=atlas-x&authSource=admin&retryWrites=true&w=majority",
);

// --- enum fields are lists, not free text ----------------------------------
check("rejects a state not on the list", !validateSubmission({ ...good, state: "Narnia" }).ok);
check("rejects a belongs_to not on the list", !validateSubmission({ ...good, belongs_to: "whoever" }).ok);
check("rejects an unsupported language code", !validateSubmission({ ...good, language: "xx" }).ok);
check(
  "other needs belongs_to_other",
  !validateSubmission({ ...good, belongs_to: "other" }).ok &&
    validateSubmission({ ...good, belongs_to: "other", belongs_to_other: "Badi Amma" }).ok,
);

// --- photo data must be raw, well-formed base64 -----------------------------
check("rejects non-base64 photo data", !validateSubmission({ ...good, photo: { ...photoOk, data: "!!!!????" } }).ok);
check(
  "rejects a data: URL prefix",
  !validateSubmission({ ...good, photo: { ...photoOk, data: "data:image/jpeg;base64,aGVsbG8=" } }).ok,
);
check("rejects base64 with a bad length", !validateSubmission({ ...good, photo: { ...photoOk, data: "aGVsbG" } }).ok);
const withOperator = validateSubmission({ ...good, photo: { ...photoOk, $where: "1" } });
check(
  "drops unknown keys from photo (no $-operators reach the store)",
  withOperator.ok && !("$where" in (withOperator.value.photo ?? {})),
);

// --- Phase 2: an @ inside the embedded password must not eat the host ------
check(
  "atlasUri: @ in an embedded password still finds the host",
  atlasUri("mongodb+srv://old:p@ss@c.abc.mongodb.net/?appName=X", "u", "p") ===
    "mongodb+srv://u:p@c.abc.mongodb.net/?appName=X&retryWrites=true&w=majority",
);

// --- body cap must leave room for the largest legal photo plus every text cap
check(
  "MAX_BODY_BYTES covers the photo cap as base64 plus the text caps",
  MAX_BODY_BYTES >= Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 200_000,
);

// --- Phase 2: invisible format characters must not make two spellings ------
check("strips zero-width space", normalizeDish("vada\u200Bpav") === "vadapav");
check("strips zero-width joiner and non-joiner", normalizeDish("dal\u200Dbaati\u200Cchurma") === "dalbaatichurma");
check("strips a BOM", normalizeDish("\uFEFFvada pav") === "vada pav");

// --- and the remaining supported scripts survive the round trip -------------
check("keeps Bengali intact", normalizeDish("ভাপা ইলিশ") === "ভাপা ইলিশ");
check("keeps Telugu intact", normalizeDish("పులిహోర") === "పులిహోర");
check("keeps Gujarati intact", normalizeDish("ઉંધિયું") === "ઉંધિયું");

// --- Phase 2: the image-mode envelope --------------------------------------
const read = { recipe_name: " Aloo Paratha ", story: "", ingredients: "atta\npotato", method: "1. knead", language: "hi" };
const manual = validateSubmission(good);
check("mode defaults to manual", manual.ok && manual.mode === "manual" && manual.extracted === undefined);
check("rejects an unknown mode", !validateSubmission({ ...good, mode: "magic" }).ok);
check("image mode needs extracted", !validateSubmission({ ...good, mode: "image", photo: photoOk }).ok);
check("image mode needs the photo it was read from", !validateSubmission({ ...good, mode: "image", extracted: read }).ok);
const image = validateSubmission({ ...good, mode: "image", extracted: read, photo: photoOk });
check(
  "image mode keeps extracted beside the submission, trimmed",
  image.ok && image.mode === "image" && image.extracted?.recipe_name === "Aloo Paratha" && image.extracted?.story === "",
);
check(
  "extracted never leaks into the submission block",
  image.ok && image.value.recipe_name === good.recipe_name && !("extracted" in image.value),
);
check("manual mode refuses extracted", !validateSubmission({ ...good, extracted: read }).ok);
check("extracted fields must be strings", !validateExtracted({ ...read, method: ["1. knead"] }).ok);
check("extracted shares the field caps", !validateExtracted({ ...read, method: "x".repeat(8001) }).ok);
check("extracted tolerates missing fields", (() => { const e = validateExtracted({}); return e.ok && e.value.method === ""; })());
check("extracted blanks an unsupported language at the boundary", (() => { const e = validateExtracted({ language: "xx" }); return e.ok && e.value.language === ""; })());
check("validatePhoto rejects nothing", !validatePhoto(undefined).ok);
check("validatePhoto measures bytes", (() => { const p = validatePhoto(photoOk); return p.ok && p.value.bytes === 5; })());

// --- Phase 2: what the extraction model returns, before anyone sees it ------
const seen = {
  is_recipe: true,
  readable: true,
  recipe_name: " Amchi Vada Pav ",
  story: "",
  ingredients: "potato\npav\nbesan",
  method: "1. boil\n2. mash\n3. fry",
  language: "mr",
  note: "",
};
const outcome = (raw: unknown): string => {
  const r = parseExtraction(raw);
  return r.ok ? "ok" : r.reason;
};
const kept = parseExtraction(seen);
check("parseExtraction: keeps a good read, trimmed", kept.ok && kept.value.recipe_name === "Amchi Vada Pav" && kept.value.language === "mr");
check("parseExtraction: not a recipe", outcome({ ...seen, is_recipe: false }) === "not_recipe");
check("parseExtraction: unreadable", outcome({ ...seen, readable: false }) === "unreadable");
check("parseExtraction: nothing read is not a recipe", outcome({ ...seen, recipe_name: "", ingredients: "", method: "" }) === "not_recipe");
check("parseExtraction: dish-only photo keeps the name", outcome({ ...seen, ingredients: "", method: "" }) === "ok");
check("parseExtraction: unsupported language becomes empty", (() => { const r = parseExtraction({ ...seen, language: "ur" }); return r.ok && r.value.language === ""; })());
check("parseExtraction: non-object is malformed", outcome("nope") === "malformed");
check("parseExtraction: over-cap field is malformed", outcome({ ...seen, method: "x".repeat(8001) }) === "malformed");
check("parseExtraction: is_recipe must be literally true", outcome({ ...seen, is_recipe: "true" }) === "not_recipe");

if (failed > 0) {
  console.error(`\ncheck-submissions: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-submissions: all validation checks pass");
