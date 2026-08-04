/**
 * Health-claim removal on generated prose.
 *
 * Rule 4 of the project allows comparative nutrition on a named axis and
 * nothing else. "More fibre" is a comparison. "More nourishing" is a verdict on
 * the reader, and the campaign does not make one. The prompt says so twice and
 * the model still reaches for the word on roughly one turn in fifteen.
 *
 * This works a sentence at a time rather than a token at a time, because the
 * same word needs two different removals depending on where it sits:
 *
 *   "You can build a more nourishing biryani."   the adjective can be cut
 *   "This version will be healthier."            cutting it leaves a stump
 *
 * So the cut is attempted first, and the result is inspected. A sentence left
 * dangling on its verb is dropped whole instead. Losing a sentence is a smaller
 * failure than shipping a health claim, and much smaller than shipping
 * "This version will be ."
 */

/**
 * A verdict on the food. The original net, and the one the prompt warns about.
 */
const VERDICT_CLAIM =
  String.raw`\b(?:much |far |even |slightly |somewhat )?(?:more |less )?(?:healthier|healthy|nourishing|nutrient[- ]dense|wholesome|good for you|better for you)\b`;

/**
 * A claim about the reader's body rather than about the dish.
 *
 * "Healthier" is the word the prompt names, so it is the word the model avoids;
 * "aids digestion" says the same thing in a register that sounds like cooking
 * knowledge and sailed straight through. It arrived on an ingredient table, in
 * the cell that explains why a component is there — the one place on a
 * recordless card with room for a sentence and nothing recorded to fill it.
 *
 * These are matched as whole phrases rather than keywords so the cut takes the
 * claim and leaves the clause: "pungent flavour, aids digestion" should become
 * "pungent flavour", not "pungent flavour, ".
 *
 * Antioxidants are deliberately absent. The swap records themselves say "keeps
 * the seed's own vitamins, antioxidants and flavour compounds", and a model
 * quoting its source faithfully must not be punished for it.
 */
const BODY_CLAIM = [
  // aids digestion · helps with digestion · supports gut health
  String.raw`\b(?:aids?|helps?|supports?|improves?|boosts?|promotes?|eases?|stimulates?|strengthens?|balances?)\s+(?:in\s+|with\s+|the\s+|your\s+)*(?:digestion|digestive\s+\w+|gut(?:\s+health)?|immunity|immune\s+\w+|metabolism|absorption)\b`,
  // good for digestion · beneficial for the gut
  String.raw`\b(?:good|great|beneficial)\s+for\s+(?:the\s+|your\s+)?(?:digestion|gut|immunity|stomach|health)\b`,
  // claims that stand on their own, with no verb to hang from
  String.raw`\b(?:gut[- ]friendly|digestive\s+(?:balance|health|aid)|immunity[- ]boosting|detox\w*|cleansing|medicinal|therapeutic|healing|anti[- ]inflammatory)\b`,
  // The bare noun, which is how the claim actually arrives once the model has
  // been told not to say "aids digestion": "for aroma and digestion" makes the
  // same promise with the verb removed, and cleared a net built around verbs.
  String.raw`\b(?:digestion|immunity|metabolism)\b`,
  // easier to digest · easily digestible · light on the stomach
  String.raw`\b(?:easy|easier|lighter)\s+to\s+digest\b`,
  String.raw`\b(?:easily\s+)?digestible\b`,
  String.raw`\blight\s+on\s+the\s+stomach\b`,
].join("|");

/** Both nets, as one source, so `guards.ts` audits exactly what this strips. */
export const HEALTH_CLAIM_SOURCE = `${VERDICT_CLAIM}|${BODY_CLAIM}`;

const CLAIM = new RegExp(HEALTH_CLAIM_SOURCE, "gi");

/** A sentence whose predicate lost its complement, or that lost its point. */
const STUMP = /\b(?:is|are|was|were|be|been|being|becomes?|became|feels?|seems?|tastes?|makes? it|renders? it)\s*[.,;:!?]/i;

/** Whitespace and punctuation left behind by a cut. */
function tidy(text: string): string {
  return (
    text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;!?])/g, "$1")
      // A lone colon closes up; the "::" of a swap row keeps its spacing.
      .replace(/[ \t]+:(?!:)/g, ":")
      // A cut at the end of a line leaves the comma or the conjunction that
      // used to join the claim to the clause before it. An ingredient row ends
      // without punctuation, so "pungent flavour, " would ship the comma and
      // the reader would look for the half that is missing. Colons are left
      // alone: the last one on the line may be the "::" of the row itself.
      .replace(/[ \t]*[,;][ \t]*(?=\n|$)/g, "")
      .replace(/[ \t]+(?:and|or|but|with)[ \t]*(?=\n|$)/gi, "")
      .replace(/\ba\s+(?=[aeiou])/gi, "an ")
      .trim()
  );
}

/** True when a sentence still reads as a sentence. */
function survives(sentence: string): boolean {
  if (STUMP.test(sentence)) return false;
  // "a version" is fine; "a ." is not.
  if (/\b(?:a|an|the|more|less)\s*[.,;:!?]/i.test(sentence)) return false;
  return sentence.replace(/[^A-Za-z]/g, "").length >= 12;
}

/** Splits on sentence ends, keeping the terminator and the space after it. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])(?=\s)/);
}

/**
 * Index just past the last sentence end, or 0 if the passage contains none.
 * A newline closes a line as firmly as a full stop does: the beats carry lists,
 * and a swap row ends without punctuation.
 */
export function lastSentenceEnd(text: string): number {
  const m = /[\s\S]*(?:[.!?]["')\]]?(?=\s)|\n)/.exec(text);
  return m ? m[0].length : 0;
}

/** Ceiling on how long a passage with no sentence end may be held. */
export const MAX_SENTENCE_HOLD = 400;

/**
 * Removes health claims from a passage of complete sentences.
 *
 * Give this whole sentences. A partial one can lose a claim that its missing
 * half would have made grammatical, so the streaming caller holds back the
 * trailing fragment until its terminator arrives.
 */
export function stripHealthClaims(text: string): string {
  if (!CLAIM.test(text)) {
    CLAIM.lastIndex = 0;
    return text;
  }
  CLAIM.lastIndex = 0;

  // The passage's own opening whitespace is layout: a beat begins on a new
  // line. It is held aside so that dropping the opening sentence cannot leave
  // the next one indented by the space that used to separate them.
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const sentences = splitSentences(text);
  const kept: string[] = [];
  let firstKept = -1;

  for (let i = 0; i < sentences.length; i++) {
    const raw = sentences[i];
    CLAIM.lastIndex = 0;
    if (!CLAIM.test(raw)) {
      if (firstKept < 0) firstKept = i;
      kept.push(raw);
      continue;
    }
    CLAIM.lastIndex = 0;

    const leading = /^\s*/.exec(raw)?.[0] ?? "";
    // And the trailing run, for the same reason. `tidy` trims both ends, so a
    // cut anywhere in a beat of ingredient rows ate the newline that ended the
    // row and welded the next one onto it: "adds pungent aroma to the dough"
    // and "lemon juice" arrived as one line. Harmless while every passage was
    // prose separated by spaces, load-bearing once a beat became a list.
    const trailing = /\s*$/.exec(raw)?.[0] ?? "";
    const cut = tidy(raw.replace(CLAIM, ""));
    if (survives(cut)) {
      if (firstKept < 0) firstKept = i;
      kept.push(leading + cut + trailing);
    }
    // else: the sentence is dropped entirely, including its leading space.
  }

  const joined = kept.join("");
  // Only when the opening sentences went does the passage need re-anchoring.
  // Otherwise its first character still belongs where the model put it, and
  // trimming it would close up the gap after the previous sentence.
  if (firstKept <= 0) return joined.trim() ? joined : "";

  // The passage's own opening whitespace is the separator from whatever came
  // before it, so it is put back exactly as it was. What goes is the whitespace
  // that belonged to the dropped sentences, which would otherwise stack up.
  const body = lead + joined.replace(/^\s+/, "");
  // Dropping every sentence of a beat would leave it blank, which reads as a
  // failure. Better an unclaimed line than an empty card section.
  return body.trim() ? body : "";
}
