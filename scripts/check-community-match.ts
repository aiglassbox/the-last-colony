/**
 * Pins the match decision: the region map, the phrase gate, and the
 * three-rule pick. All three are pure functions in `src/lib/community/match.ts`
 * — no network, no store, no env — so this script runs in `npm run check`
 * with nothing behind it.
 *
 *   npx tsx scripts/check-community-match.ts
 */
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

if (failed > 0) {
  console.error(`\ncheck-community-match: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-community-match: all match checks pass");
