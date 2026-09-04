/**
 * Pins the match decision: the region map, the phrase gate, and the
 * three-rule pick. All three are pure functions in `src/lib/community/match.ts`
 * — no network, no store, no env — so this script runs in `npm run check`
 * with nothing behind it.
 *
 *   npx tsx scripts/check-community-match.ts
 */
import { toCommunityCard, type TranslatedFields } from "../src/lib/community/card";
import { STATES } from "../src/lib/community/schema";
import {
  phraseMatches,
  pickCommunity,
  stateForRegion,
  REGION_TO_STATE,
  type CommunityMatch,
} from "../src/lib/community/match";
import { normalizeDish } from "../src/lib/community/normalize";

let failed = 0;
function check(name: string, pass: boolean): void {
  if (!pass) {
    failed += 1;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

// --- the phrase gate -------------------------------------------------------
// Tag `puran-poli`, aliases from the seeded Maharashtra/Gujarat/Karnataka trio.
const tag = "puran-poli";
const aliases = ["puran poli", "vedmi", "holige", "obbattu"];
const matchesQuery = (query: string) => phraseMatches(normalizeDish(query), tag, aliases);

check("'puran poli' matches", matchesQuery("puran poli"));
check("'Puran Poli' matches (case-insensitive)", matchesQuery("Puran Poli"));
check("a full sentence containing the phrase matches", matchesQuery("how do I make puran poli at home"));
check("'puran' alone does not match", !matchesQuery("puran"));
check("'poli' alone does not match", !matchesQuery("poli"));
check("'puranpoli' (no space) does not match the tag", !matchesQuery("puranpoli"));
check("'holige' (an alias) matches", matchesQuery("holige"));
check("'apuran polix' does not match (not on token boundaries)", !matchesQuery("apuran polix"));
check("empty string does not match", !matchesQuery(""));

// Seed entry 12: a Devanagari row tagged thalipith, aliases in Latin and
// Devanagari. Pin the real shape rather than trusting it.
const dTag = "thalipith";
const dAliases = ["thalipith", "thalipeeth", "थालीपीठ"];
check(
  "Devanagari alias matches the same text typed by a reader",
  phraseMatches(normalizeDish("थालीपीठ"), dTag, dAliases),
);
check(
  "a zero-width joiner pasted into the query does not break the Devanagari match",
  phraseMatches(normalizeDish("था‍लीपीठ"), dTag, dAliases),
);

// Empty query, empty tag and empty alias are all no-match.
check("empty normalized query never matches", !phraseMatches("", "some-tag", ["some alias"]));
check("empty tag does not match on its own", !phraseMatches(normalizeDish("puran poli"), "", []));
check(
  "an empty alias in the list contributes no match",
  !phraseMatches(normalizeDish("puran poli"), "unrelated-tag", ["", "also unrelated"]),
);

// --- the region map ---------------------------------------------------------
check("MH -> Maharashtra", stateForRegion("MH") === "Maharashtra");
check("GJ -> Gujarat", stateForRegion("GJ") === "Gujarat");
check("KA -> Karnataka", stateForRegion("KA") === "Karnataka");
check("TG -> Telangana", stateForRegion("TG") === "Telangana");
check("lowercase mh -> Maharashtra", stateForRegion("mh") === "Maharashtra");
check("an unknown code -> null", stateForRegion("ZZ") === null);
check("null -> null", stateForRegion(null) === null);

// Every value the map produces must be a real member of STATES — this is the
// one check that catches a typo, so it walks the actual entries rather than a
// hand-picked few.
for (const [code, state] of REGION_TO_STATE) {
  check(`region map: ${code} -> a member of STATES`, STATES.includes(state));
}
check(
  "region map covers every one of the 36 STATES, no more and no fewer",
  new Set(REGION_TO_STATE.map(([, state]) => state)).size === STATES.length,
);

// --- the pick ----------------------------------------------------------------
// The pick fixtures in the brief are partial objects (state/language/published_at
// only) — not a real CommunityMatch. This factory fills the rest with obvious
// placeholders so the fixtures stay as readable as the brief writes them,
// without weakening CommunityMatch to fit.
function fixture(
  partial: { state: string; language: string | null; published_at: Date },
  id: string,
): CommunityMatch {
  return {
    id,
    state: partial.state,
    language: partial.language,
    published_at: partial.published_at,
    // Fixed: nothing in the pick reads created_at, and no fixture asserts on
    // it. It rides along because the card dates a recipe by when it was
    // submitted, not by when an operator got round to publishing it.
    created_at: new Date("2026-08-01"),
    dish: { tag: "placeholder-dish", aliases: [] },
    submission: {
      recipe_name: "Placeholder Recipe",
      display_name: "Placeholder Submitter",
      belongs_to: "my own",
      story: "placeholder story",
      ingredients: "placeholder ingredients",
      method: "placeholder method",
    },
  };
}

const A = fixture({ state: "Maharashtra", language: "mr", published_at: new Date("2026-09-01") }, "A");
const B = fixture({ state: "Madhya Pradesh", language: "hi", published_at: new Date("2026-09-03") }, "B");
const C = fixture({ state: "Karnataka", language: "kn", published_at: new Date("2026-09-02") }, "C");
const D = fixture({ state: "Maharashtra", language: "en", published_at: new Date("2026-09-04") }, "D");
const all = [D, B, C, A]; // published_at descending, as the store returns it

check("MH / mr -> A (state match, reader's language)", pickCommunity(all, "MH", "mr") === A);
check("MH / en -> D (same region as above; language decides between the two)", pickCommunity(all, "MH", "en") === D);
check("MP / hi -> B (state match)", pickCommunity(all, "MP", "hi") === B);
check("KL / en -> D (no state match; falls to recency)", pickCommunity(all, "KL", "en") === D);
check("TN / ta -> D (no state, no language match; falls to recency)", pickCommunity(all, "TN", "ta") === D);
check("null region / hi -> B (no region at all; language match)", pickCommunity(all, null, "hi") === B);
check("MH / null reader language -> D (rule 2 skipped, not guessed)", pickCommunity(all, "MH", null) === D);
check("unknown code / kn -> C (region map misses; language match)", pickCommunity(all, "ZZ", "kn") === C);

// A row whose source language is unknown (the store's "" normalised to null).
const E = fixture({ state: "Kerala", language: null, published_at: new Date("2026-09-05") }, "E");
const withUnknown = [E, D, B, C, A]; // published_at descending
check("KL / en -> E (unknown language still wins rule 1 on state)", pickCommunity(withUnknown, "KL", "en") === E);
check(
  "TN / en -> D (E is newest, but unknown never wins rule 2; D is the English row)",
  pickCommunity(withUnknown, "TN", "en") === D,
);
check("TN / ta -> E (neither rule matches; newest wins)", pickCommunity(withUnknown, "TN", "ta") === E);

// Edge cases.
check("an empty match list gives null", pickCommunity([], "MH", "en") === null);
const only = fixture({ state: "Goa", language: "en", published_at: new Date("2026-09-01") }, "only");
check("a single-element list returns that element for any region/language", pickCommunity([only], "ZZ", "xx") === only);
check("a single-element list returns that element for null region/language", pickCommunity([only], null, null) === only);

// --- the served payload -----------------------------------------------------
// `toCommunityCard` maps a full `CommunityMatch` (not the partial pick
// fixtures above) to what a reader is allowed to see. A dedicated factory
// because every submission field is in play here — belongs_to, city, a
// photo, multi-line text — none of which the pick cares about.
function cardFixture(
  overrides: Partial<CommunityMatch> = {},
  submissionOverrides: Partial<CommunityMatch["submission"]> = {},
): CommunityMatch {
  return {
    id: "6a98996d7608d2116cde5615",
    state: "Maharashtra",
    language: "mr",
    published_at: new Date("2026-09-01T00:00:00.000Z"),
    created_at: new Date("2026-08-20T10:00:00.000Z"),
    dish: { tag: "puran-poli", aliases: ["puran poli"] },
    submission: {
      recipe_name: "Puran Poli",
      display_name: "Aaji Kore",
      belongs_to: "grandmother",
      city: "Pune",
      story: "A festival sweet, made every year for Gudi Padwa.",
      ingredients: "- chana dal\n- jaggery\n\n- wheat flour",
      method: "1. Cook dal.\n2. Mash.\n3) Roll.",
      ...submissionOverrides,
    },
    ...overrides,
  };
}

// The contact/photo-data leak sweep. `CommunityMatch` has no `contact` field
// and its photo carries no `data` field — a type assertion stands in for a
// future spread or projection change that would add either, which is exactly
// the mistake this walks `JSON.stringify` for rather than trusting the type.
const leaky = cardFixture(
  {},
  {
    photo: { mime: "image/jpeg", bytes: 65516, data: "QQ==".repeat(2000) } as CommunityMatch["submission"]["photo"],
  },
);
(leaky.submission as unknown as { contact: string }).contact = "leaky-contact@example.com";
const leakyCard = toCommunityCard(leaky, [], 1, null);
const leakyJson = JSON.stringify(leakyCard);
check("card: serialized payload has no contact key", !leakyJson.includes("contact"));
check("card: serialized payload has none of the fixture's contact string", !leakyJson.includes("leaky-contact@example.com"));
check("card: serialized payload has no photo data key", !leakyJson.includes('"data"'));

// Every string anywhere in the card, recursively — the blob-size assertion
// below walks this rather than checking top-level fields only. A fixture-level
// guard against base64 sneaking through, per the brief: the real cap on
// `method` is 8000 characters, so this is not a check inside `toCommunityCard`
// itself, which must accept a legitimately long method untouched.
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}
check("card: no string over 4000 characters", allStrings(leakyCard).every((s) => s.length <= 4000));

// belongs_to: the label for a listed value, the free text for "other", the
// raw value for a legacy document carrying something unlisted.
check(
  "card: belongs_to renders the human label for a listed value",
  toCommunityCard(cardFixture({}, { belongs_to: "grandmother" }), [], 1, null).belongs_to === "Grandmother",
);
check(
  "card: belongs_to renders the free text when the value is other",
  toCommunityCard(cardFixture({}, { belongs_to: "other", belongs_to_other: "A neighbour's aunt" }), [], 1, null)
    .belongs_to === "A neighbour's aunt",
);
check(
  "card: belongs_to renders the raw value for an unlisted legacy value",
  toCommunityCard(cardFixture({}, { belongs_to: "family cook" }), [], 1, null).belongs_to === "family cook",
);

// ingredients/method: split per non-blank line, bullets and step numbers stripped.
const linesCard = toCommunityCard(
  cardFixture(
    {},
    {
      ingredients: "- chana dal\n\n* jaggery\n1. wheat flour",
      method: "1. Cook dal.\n\n2) Mash.\n- Roll.",
    },
  ),
  [],
  1,
  null,
);
check("card: ingredients split per non-blank line, bullets/numbers stripped", linesCard.ingredients.join("|") === "chana dal|jaggery|wheat flour");
check("card: method split per non-blank line, bullets/numbers stripped", linesCard.method.join("|") === "Cook dal.|Mash.|Roll.");

// photo_url: null with no photo, the route URL with one.
check("card: photo_url is null with no photo", toCommunityCard(cardFixture(), [], 1, null).photo_url === null);
const withPhoto = cardFixture({}, { photo: { mime: "image/jpeg", bytes: 65516 } });
check(
  "card: photo_url is /api/community/photo/<id> with one",
  toCommunityCard(withPhoto, [], 1, null).photo_url === `/api/community/photo/${withPhoto.id}`,
);

// language: null rather than "" when unknown.
check(
  "card: language is null rather than empty string when unknown",
  toCommunityCard(cardFixture({ language: null }), [], 1, null).language === null,
);

// translation supplied: top-level fields carry the translated text, language
// is the target language, translated_from carries the original with the
// original language.
const translation: TranslatedFields = {
  lang: "hi",
  recipe_name: "पूरन पोळी",
  story: "एक त्योहार की मिठाई।",
  ingredients: "- चना दाल\n- गुड़",
  method: "1. दाल पकाएं।\n2. मैश करें।",
  model: "gemini-3.1-flash",
};
const translated = toCommunityCard(cardFixture({ language: "mr" }), [], 1, translation);
check(
  "card: with a translation, top-level fields carry the translated text",
  translated.recipe_name === "पूरन पोळी" &&
    translated.story === "एक त्योहार की मिठाई।" &&
    translated.ingredients.join("|") === "चना दाल|गुड़" &&
    translated.method.join("|") === "दाल पकाएं।|मैश करें।",
);
check("card: with a translation, language is the target language", translated.language === "hi");
check(
  "card: translated_from carries the original text under the original language",
  translated.translated_from !== null &&
    translated.translated_from.language === "mr" &&
    translated.translated_from.recipe_name === "Puran Poli" &&
    translated.translated_from.ingredients.join("|") === "chana dal|jaggery|wheat flour",
);

// Trap 1: a translated row's original language can genuinely be null — the
// store writes "" when the model could not tell, which normalises to null on
// `CommunityMatch.language`, and Task 6 translates an unknown-source row into
// every language anyway. The original text still renders; it just carries no
// language to put on a `lang` attribute.
const translatedUnknownSource = toCommunityCard(cardFixture({ language: null }), [], 1, translation);
check(
  "card: translated_from.language is null when the original source language is unknown",
  translatedUnknownSource.translated_from !== null && translatedUnknownSource.translated_from.language === null,
);

// no translation supplied: translated_from is null.
check(
  "card: translated_from is null with no translation supplied",
  toCommunityCard(cardFixture(), [], 1, null).translated_from === null,
);

// other_states and total carry straight through from the match query, never touched by the mapper.
check(
  "card: other_states and total carry through unchanged",
  toCommunityCard(cardFixture(), ["Gujarat", "Karnataka"], 7, null).other_states.join(",") === "Gujarat,Karnataka" &&
    toCommunityCard(cardFixture(), [], 7, null).total === 7,
);

if (failed > 0) {
  console.error(`\ncheck-community-match: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-community-match: all match checks pass");
