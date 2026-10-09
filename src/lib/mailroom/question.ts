import { phraseMatches } from "@/lib/community/match";
import { normalizeDish } from "@/lib/community/normalize";

/** Long enough for any real question, short enough that a link stays a link. */
export const QUESTION_MAX = 200;

/** The default Try-it question. The operator can rewrite it on the page. */
export function tryQuestion(displayName: string, recipeName: string): string {
  return `Give me ${displayName.trim()}'s ${recipeName.trim().toLowerCase()} recipe`;
}

/** The home page reads `q` and types it into the chat box; see `Chat.tsx`. */
export function tryUrl(site: string, question: string): string {
  return `${site}/?q=${encodeURIComponent(question)}`;
}

/**
 * Whether Kranti would find this recipe from this question: the same
 * `phraseMatches` rule chat applies to the reader's own words. A question
 * edited until it no longer names the dish brings the reader to a different
 * answer, so the page warns before sending; it does not block.
 */
export function questionFindsRecipe(question: string, tag: string, aliases: readonly string[]): boolean {
  return phraseMatches(normalizeDish(question), tag, [...aliases]);
}
