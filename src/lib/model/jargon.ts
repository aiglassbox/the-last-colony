/**
 * Laboratory vocabulary, translated back into kitchen words.
 *
 * The voice rule is everyday language and no nutrition-label register: what a
 * person would say across a counter, not what is printed on the back of a
 * packet. The prompt says so and names the words. It still came back with "you
 * lose the micronutrients in the trade" on a swap reply and "slower
 * carbohydrate release" on a fusion card, so this is the net, on the same
 * principle as the em dash and the markdown asterisk: a prompt rule holds most
 * of the time, a rewrite holds every time.
 *
 * TRANSLATED, NOT DELETED, and that is the whole design.
 *
 * A health claim is a liability, so `stripHealthClaims` cuts it and drops the
 * sentence if what is left does not read. Jargon is not a liability, it is a
 * register, and the sentence around it is usually saying something true and
 * worth keeping. Dropping "cold pressing keeps the fatty-acid profile" loses a
 * real comparison; rewriting it to "keeps the kind of fat" keeps the comparison
 * and loses only the lab coat. So `PLAIN` holds substitutions that mean exactly
 * what the term meant, and nothing is deleted.
 *
 * `LAB_ONLY` is the other half and is deliberately not rewritten. Some terms
 * have no short plain equivalent that says the same thing: "complex
 * carbohydrate" is not "whole grain", "polyphenol" is not "plant goodness", and
 * a substitution that shifts the meaning is worse than the jargon, because a
 * reader cannot see that it happened. Those are audited instead, so they surface
 * in the logs the way a provenance leak does rather than being quietly mangled.
 *
 * Runs on model output only. Corpus text is left as recorded — and the swap
 * records have been rewritten in plain words at source, so a model quoting one
 * faithfully has nothing here to trip.
 */

/**
 * Term to plain equivalent. Ordered longest-first at build time so "dietary
 * fibre" is matched before a bare "fibre" rule could see it.
 */
const PLAIN: Array<[term: string, plain: string]> = [
  ["micronutrients", "vitamins and minerals"],
  ["micronutrient", "vitamin or mineral"],
  ["macronutrients", "protein, fat and starch"],
  ["macronutrient", "protein, fat or starch"],
  ["amino acids", "protein"],
  ["amino acid", "protein"],
  ["dietary fibre", "fibre"],
  ["dietary fiber", "fibre"],
  ["insoluble fibre", "fibre"],
  ["soluble fibre", "fibre"],
  ["fatty-acid profile", "kind of fat"],
  ["fatty acid profile", "kind of fat"],
  ["lipid profile", "kind of fat"],
  ["flavour compounds", "flavour"],
  ["flavor compounds", "flavour"],
  ["aromatic compounds", "aroma"],
  ["volatile compounds", "aroma"],
  ["aroma compounds", "aroma"],
  ["saturated fat content", "saturated fat"],
  ["protein content", "protein"],
  ["fibre content", "fibre"],
  ["iron content", "iron"],
  // The one that arrived on a live card. It is glycaemic load said at length,
  // and glycaemic load is an axis the brief names and this project compares on,
  // so the plain form is the sanctioned one rather than an invention.
  ["slower carbohydrate release", "lower glycaemic load"],
  ["slow carbohydrate release", "lower glycaemic load"],
  ["slower release of carbohydrate", "lower glycaemic load"],
  ["blood sugar spike", "glycaemic load"],
];

/**
 * Terms with no substitution that means the same thing. Logged, never rewritten
 * — a reader can argue with jargon they can see, but not with a paraphrase that
 * quietly changed the claim.
 */
const LAB_ONLY = [
  "phytates",
  "phytate",
  "polyphenols",
  "polyphenol",
  "complex carbohydrates",
  "complex carbohydrate",
  "empty calories",
  "bioavailable",
  "glycaemic index",
  "glycemic index",
  "antinutrients",
  "antinutrient",
  "prebiotic",
  "probiotic",
  "enzymatic",
  "oxidative",
];

/**
 * British spellings, because the corpus, the prompt and the cards are all
 * written in them and the model mixes the two inside a single card: one live
 * reply said "more fiber and protein" two lines above "regional flavour". The
 * inconsistency reads as machine-assembled even when nothing else does.
 */
const SPELLING: Array<[RegExp, string]> = [
  [/\bfiber\b/g, "fibre"],
  [/\bFiber\b/g, "Fibre"],
  [/\bflavor\b/g, "flavour"],
  [/\bFlavor\b/g, "Flavour"],
  [/\bflavors\b/g, "flavours"],
  [/\bflavorful\b/g, "flavourful"],
  [/\bsavory\b/g, "savoury"],
  [/\bSavory\b/g, "Savoury"],
  [/\bcolor\b/g, "colour"],
  [/\bColor\b/g, "Colour"],
  [/\bcolors\b/g, "colours"],
  [/\bcaramelize\b/g, "caramelise"],
  [/\bcaramelized\b/g, "caramelised"],
  [/\bcarmelized\b/g, "caramelised"],
  [/\bglycemic\b/g, "glycaemic"],
  [/\bGlycemic\b/g, "Glycaemic"],
];

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TRANSLATIONS: Array<[RegExp, string]> = [...PLAIN]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([term, plain]) => [new RegExp(`\\b${escape(term)}\\b`, "gi"), plain]);

/** Source shared with the audit, so what is reported is what is not rewritten. */
export const LAB_ONLY_SOURCE = `\\b(?:${LAB_ONLY.map(escape).join("|")})\\b`;

/**
 * Plain words in place of lab ones, and one spelling throughout.
 *
 * Case is not preserved on a substitution. Every term here is a common noun
 * that appears mid-sentence in this prose, and a sentence-initial "Micronutrient
 * ..." has not been seen; keeping the mapping literal keeps it readable.
 */
export function plainWords(text: string): string {
  let out = text;
  for (const [pattern, plain] of TRANSLATIONS) out = out.replace(pattern, plain);
  for (const [pattern, spelling] of SPELLING) out = out.replace(pattern, spelling);
  return out;
}

/** The terms left standing, for the log. */
export function labTerms(text: string): string[] {
  return [...new Set(text.match(new RegExp(LAB_ONLY_SOURCE, "gi")) ?? [])];
}
