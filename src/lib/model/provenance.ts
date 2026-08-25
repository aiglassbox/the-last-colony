import { splitSentences } from "./health";

/**
 * The provenance class, removed from generated prose.
 *
 * This is red line #2, and it was the one protection in the project that
 * detected its own failure and shipped it anyway. `guards.ts` has always logged
 * `[provenance-leak]` when a completion names a class, on the reasoning that
 * the badge renders the real class from the record so a typed one cannot become
 * the citation. That is true of the badge and false of the sentence: a live
 * upma card came back with "This is ATTESTED in regional culinary archives and
 * Dravidian culinary lexicography." in the body, the log recorded
 * `provenanceClaims: ["ATTESTED"]`, and the reader saw the word.
 *
 * AGENTS.md is unambiguous about the stakes — "a model has already been caught
 * calling an unverified record ATTESTED; assume the next one will try" — so the
 * detection now has a removal behind it, the way the health claim, the em dash
 * and the markdown asterisk do. The audit stays exactly as it was: what this
 * removes, `guards.ts` still reports, so the logs keep showing how often the
 * model reaches for it.
 *
 * WHY A SENTENCE AND NOT A WORD. Cutting "ATTESTED" out of that upma sentence
 * leaves "This is in regional culinary archives and Dravidian culinary
 * lexicography", which is worse than the original: still an attribution, now
 * ungrammatical, and pointing at sources the source strip is not showing. A
 * sentence whose subject is how certain we are has nothing left once the
 * certainty goes, so it goes whole. A class word used as a passing adjective is
 * cut in place and the sentence around it kept.
 *
 * Never empties a turn. A completion that is nothing but provenance talk is a
 * bad answer, and a blank card is worse.
 */

// ponytail: the class tokens are Latin, so this bare-word cut fires even inside
// a Hindi or Tamil reply — the highest-stakes leak (a model typing "ATTESTED")
// is caught in every language. The sentence-level GRADING repair below is
// English-syntax and English-only; the non-English grading claim is held off by
// the in-language prompt rule and checked by `npm run guards:check-multilingual`.
/** The class names. Shared with the audit so the two cannot drift apart. */
export const PROVENANCE_CLASS_SOURCE = String.raw`\b(?:attested|reconstructed|inferred)\b`;

/**
 * A sentence whose whole job is grading the record. Matched anywhere in the
 * sentence rather than at its start, because the clause arrives mid-sentence
 * about as often as it opens one.
 */
const GRADING = new RegExp(
  String.raw`\b(?:this|it|that|the\s+(?:dish|record|recipe|version|preparation|text|source)|this\s+one)\s+` +
    String.raw`(?:is|was|remains|stands\s+as)\s+(?:an?\s+|our\s+|the\s+)?(?:\w+\s+){0,2}?` +
    String.raw`(?:attested|reconstructed|inferred)\b`,
  "i",
);

/** The house word for the whole idea, which rule 6 already bans on its own. */
const HOUSE_WORD = /\bprovenance\b/i;

const CLASS_WORD = new RegExp(PROVENANCE_CLASS_SOURCE, "gi");

/** Whitespace, articles and punctuation left behind by a cut. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;!?])/g, "$1")
    .replace(/\ban\s+(?=[^aeiou\s])/gi, "a ")
    .replace(/\ba\s+(?=[aeiou])/gi, "an ")
    .trim();
}

/** True when what is left of a sentence still reads as one. */
function survives(sentence: string): boolean {
  if (/\b(?:is|are|was|were|be|been|being)\s*[.,;:!?]/i.test(sentence)) return false;
  if (/\b(?:is|are|was|were)\s+(?:in|from|by|as)\b/i.test(sentence)) return false;
  return sentence.replace(/[^A-Za-z]/g, "").length >= 12;
}

/**
 * Removes provenance grading from a passage of complete sentences.
 *
 * Give this whole sentences, as with `stripHealthClaims`: the streaming caller
 * already holds its trailing fragment back to the last sentence boundary, and
 * this reuses that same cut.
 */
export function stripProvenanceClaims(text: string): string {
  const hasClass = new RegExp(PROVENANCE_CLASS_SOURCE, "i").test(text);
  if (!hasClass && !HOUSE_WORD.test(text)) return text;

  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const sentences = splitSentences(text);
  const kept: string[] = [];
  let firstKept = -1;

  for (let i = 0; i < sentences.length; i++) {
    const raw = sentences[i];

    // A sentence that exists to grade the record goes whole. Cutting the word
    // out of one leaves an attribution with nothing behind it.
    //
    // "Provenance" takes the same treatment rather than a word-level cut. It is
    // house vocabulary the reader should never meet, and excising it mid-clause
    // leaves the scaffolding standing: "the provenance class here" cuts down to
    // "the here". A sentence reaching for the word is talking about our filing
    // rather than about food, so there is nothing in it worth repairing.
    if (GRADING.test(raw) || HOUSE_WORD.test(raw)) continue;

    CLASS_WORD.lastIndex = 0;
    if (!CLASS_WORD.test(raw)) {
      if (firstKept < 0) firstKept = i;
      kept.push(raw);
      continue;
    }
    CLASS_WORD.lastIndex = 0;

    const leading = /^\s*/.exec(raw)?.[0] ?? "";
    const trailing = /\s*$/.exec(raw)?.[0] ?? "";
    const cut = tidy(raw.replace(CLASS_WORD, ""));
    if (survives(cut)) {
      if (firstKept < 0) firstKept = i;
      kept.push(leading + cut + trailing);
    }
  }

  const joined = kept.join("");
  if (firstKept <= 0) return joined.trim() ? joined : "";

  const body = lead + joined.replace(/^\s+/, "");
  return body.trim() ? body : "";
}
