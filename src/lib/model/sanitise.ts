import type { CorpusRecord } from "@/lib/corpus/types";

import { auditProse, isClean } from "./guards";
import { stripHealthClaims } from "./health";
import { findLeak, LEAK_REFUSAL } from "./leak";
import { styleProse } from "./punctuation";

/**
 * The house rules, applied to a completion that arrived whole.
 *
 * The chat route runs every one of these against its stream, a chunk at a time,
 * because it renders as it writes. Any other caller gets its text in one piece
 * and had been shipping it raw: `/api/swap` returned model prose that no rule
 * had touched, so a health claim, an em dash, a markdown asterisk or a prompt
 * dump left by that door unimpeded while the same sentence would have been
 * caught leaving by the other.
 *
 * The protections were never swap-specific or chat-specific. They are what this
 * project will and will not say, so they belong somewhere both doors can reach.
 *
 * Streaming callers cannot use this: they need the sentence-boundary hold in
 * `lastSentenceEnd` and the incremental leak window, neither of which applies to
 * a passage that is already complete.
 */
export function sanitiseCompletion(
  text: string,
  records: CorpusRecord[],
  context: { where: string; vendor: string; model: string; query?: string },
): string {
  const leaked = findLeak(text);
  if (leaked) {
    console.warn(
      `[prompt-leak] ${JSON.stringify({ ...context, fingerprint: leaked })}`,
    );
    return LEAK_REFUSAL;
  }

  // Whole sentences by construction, which is what the health pass needs: it
  // judges a claim against the sentence around it and drops the sentence when
  // cutting the claim would leave a stump.
  const clean = stripHealthClaims(styleProse(text));

  const audit = auditProse(clean, records);
  if (!isClean(audit)) {
    console.warn(`[provenance-leak] ${JSON.stringify({ ...context, ...audit })}`);
  }

  return clean;
}
