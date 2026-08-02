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

const CLAIM =
  /\b(?:much |far |even |slightly |somewhat )?(?:more |less )?(?:healthier|healthy|nourishing|nutrient[- ]dense|wholesome|good for you|better for you)\b/gi;

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
    const cut = tidy(raw.replace(CLAIM, ""));
    if (survives(cut)) {
      if (firstKept < 0) firstKept = i;
      kept.push(leading + cut);
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
