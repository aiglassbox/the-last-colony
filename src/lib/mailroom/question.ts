/** Long enough for any real question, short enough that a link stays a link. */
export const QUESTION_MAX = 200;

/** The default Try-it question. The operator can rewrite it on the page. */
export function tryQuestion(displayName: string, recipeName: string): string {
  return `Give me ${displayName.trim()}'s ${recipeName.trim().toLowerCase()} recipe`;
}

/**
 * The home page reads `q` and types it into the chat box, and sends `r` with
 * it; see `Chat.tsx`. `r` is what makes the button exact: chat serves that
 * submission by id, so the question is only the words on screen and two
 * people's recipes for one dish cannot be mixed up.
 */
export function tryUrl(site: string, question: string, id: string): string {
  return `${site}/?q=${encodeURIComponent(question)}&r=${id}`;
}
