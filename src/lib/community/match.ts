import { normalizeDish } from "./normalize";

/**
 * The whole matching decision as pure functions: a region map, a phrase gate,
 * and a three-rule pick. No network, no store, no scoring — every input here
 * is an array already in hand, which is what makes it testable with neither.
 */

/**
 * The projected shape the pick and the (Task 5) card mapper both work over.
 * `state` and `language` are flattened out of the document on read, so
 * neither the picker nor the card mapper has to know where they live.
 */
export interface CommunityMatch {
  id: string;
  /** submission.state — the form's answer, which outranks edge geo. */
  state: string;
  /** dish.language — the model's reading of what the text is written in.
   *  The store writes "" when the model could not tell; that normalises to
   *  null here, so "unknown" can never accidentally equal a reader's language. */
  language: string | null;
  published_at: Date;
  /** When the reader submitted it, which is what the card dates — not when an
   *  operator got round to publishing it. */
  created_at: Date;
  dish: { tag: string; aliases: string[] };
  submission: {
    recipe_name: string;
    display_name: string;
    belongs_to: string;
    belongs_to_other?: string;
    city?: string;
    story: string;
    ingredients: string;
    method: string;
    photo?: { mime: string; bytes: number };
  };
}

/**
 * Region code (ISO 3166-2, e.g. "MH") -> the full state name as
 * `submission.state` stores it, matching `STATES` in ./schema.ts exactly.
 * Written as explicit pairs rather than derived from STATES by index, so a
 * reordering of STATES cannot silently repoint a code at the wrong name.
 *
 * Three names carry a second (or third) code because vendors disagree, and
 * the only authority on what Vercel actually sends is a real production
 * request: Odisha (OR is the ISO code, OD is seen in the wild), Uttarakhand
 * (UT is the ISO code, UK is seen in the wild), and Dadra and Nagar Haveli
 * and Daman and Diu (DH, DN and DD are all seen). The raw region value is
 * logged on `community_served` (Task 8) precisely so these guesses can be
 * confirmed against real traffic and the losing spellings deleted.
 */
export const REGION_TO_STATE: ReadonlyArray<readonly [string, string]> = [
  ["AP", "Andhra Pradesh"],
  ["AR", "Arunachal Pradesh"],
  ["AS", "Assam"],
  ["BR", "Bihar"],
  ["CT", "Chhattisgarh"],
  ["GA", "Goa"],
  ["GJ", "Gujarat"],
  ["HR", "Haryana"],
  ["HP", "Himachal Pradesh"],
  ["JH", "Jharkhand"],
  ["KA", "Karnataka"],
  ["KL", "Kerala"],
  ["MP", "Madhya Pradesh"],
  ["MH", "Maharashtra"],
  ["MN", "Manipur"],
  ["ML", "Meghalaya"],
  ["MZ", "Mizoram"],
  ["NL", "Nagaland"],
  ["OR", "Odisha"],
  ["OD", "Odisha"],
  ["PB", "Punjab"],
  ["RJ", "Rajasthan"],
  ["SK", "Sikkim"],
  ["TN", "Tamil Nadu"],
  ["TG", "Telangana"],
  ["TR", "Tripura"],
  ["UP", "Uttar Pradesh"],
  ["UT", "Uttarakhand"],
  ["UK", "Uttarakhand"],
  ["WB", "West Bengal"],
  ["AN", "Andaman and Nicobar Islands"],
  ["CH", "Chandigarh"],
  ["DH", "Dadra and Nagar Haveli and Daman and Diu"],
  ["DN", "Dadra and Nagar Haveli and Daman and Diu"],
  ["DD", "Dadra and Nagar Haveli and Daman and Diu"],
  ["DL", "Delhi"],
  ["JK", "Jammu and Kashmir"],
  ["LA", "Ladakh"],
  ["LD", "Lakshadweep"],
  ["PY", "Puducherry"],
];

const REGION_MAP: ReadonlyMap<string, string> = new Map(REGION_TO_STATE);

/** `geo.region` (e.g. "MH") -> the full state name, or null off the map or off Vercel. */
export function stateForRegion(region: string | null): string | null {
  if (!region) return null;
  return REGION_MAP.get(region.toUpperCase()) ?? null;
}

/**
 * Whether `normalizedQuery` contains `phrase` as a whole phrase: equal to it,
 * or containing it bounded by string start/end or a space on each side.
 * Plain `indexOf` scanning with explicit boundary checks, not a constructed
 * regex — a stored alias is model output from a document a member of the
 * public submitted, and `new RegExp(alias)` would hand that text the regex
 * engine.
 */
function containsPhrase(normalizedQuery: string, phrase: string): boolean {
  if (!phrase) return false;
  let from = 0;
  for (;;) {
    const at = normalizedQuery.indexOf(phrase, from);
    if (at === -1) return false;
    const boundedBefore = at === 0 || normalizedQuery[at - 1] === " ";
    const end = at + phrase.length;
    const boundedAfter = end === normalizedQuery.length || normalizedQuery[end] === " ";
    if (boundedBefore && boundedAfter) return true;
    from = at + 1;
  }
}

/**
 * The deterministic match: does the reader's (already normalized) query name
 * this dish? `normalizeDish` already turns every non-letter/mark/number run
 * (hyphens included) into a single space, so `normalizeDish(tag)` alone turns
 * "puran-poli" into "puran poli" — no separate hyphen replacement is needed.
 * Aliases are run through `normalizeDish` again here even though the pipeline
 * stores them pre-normalized (`pipeline.ts`), because a document written
 * before that was true must not slip through unnormalized.
 */
export function phraseMatches(normalizedQuery: string, tag: string, aliases: string[]): boolean {
  if (!normalizedQuery) return false;
  const candidates = [normalizeDish(tag), ...aliases.map((alias) => normalizeDish(alias))];
  return candidates.some((phrase) => containsPhrase(normalizedQuery, phrase));
}

/**
 * Three rules, each filtering what the last one left; only the third chooses.
 * `matches` arrives sorted by published_at descending, so "the first survivor"
 * is "the most recently published" at every stage and rule 3 needs no
 * comparison of its own.
 */
export function pickCommunity(
  matches: CommunityMatch[],
  region: string | null,
  readerLang: string | null,
): CommunityMatch | null {
  if (!matches.length) return null;
  const state = stateForRegion(region);
  const byState = state ? matches.filter((m) => m.state === state) : [];
  // Rule 1 wins outright: a reader's own state beats a language they can read.
  const pool = byState.length ? byState : matches;
  // Rule 2 is skipped when detection fell back rather than guessing English:
  // a wrong guess hands someone a language they never asked for.
  if (!readerLang) return pool[0];
  // A row whose source language is unknown carries null and so matches nobody
  // here. It can still win on state or on recency; it just never wins on
  // "you can read this one in the author's own words", which would be a claim
  // nothing supports.
  const byLang = pool.filter((m) => m.language === readerLang);
  return byLang.length ? byLang[0] : pool[0];
}
