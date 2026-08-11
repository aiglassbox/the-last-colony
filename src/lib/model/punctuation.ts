/**
 * House style enforced on generated prose.
 *
 * The brief asks for writing that does not read as generated, and the prompt
 * asks for two things in particular: no em dashes, and no markdown. Both are
 * asked for and both are ignored often enough to matter, so these are the nets.
 * A prompt rule holds most of the time; a rewrite holds every time.
 *
 * Everything here is single-pass and order-independent across chunk boundaries,
 * because it runs on a stream. `danglingTail` names the trailing run a caller
 * must hold back so no rewrite ever sees half of its own input.
 *
 * It runs on model output only. Corpus text is left exactly as recorded: a
 * record is a source, and restyling its punctuation is the same class of move
 * as rewriting its citation.
 */

/**
 * A dash between two words is an aside, and a comma carries it. A dash before
 * punctuation or at the end of a line was doing structural work instead, and
 * reads better gone than replaced with a stray comma.
 *
 * Only spaces and tabs are absorbed around the dash. A newline is layout, since
 * the beats carry lists, so it survives the rewrite untouched.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/[ \t]*—[ \t]*/g, (match, offset: number, full: string) => {
    const next = full.charAt(offset + match.length);
    return !next || /[\s.,;:!?)\]]/.test(next) ? "" : ", ";
  });
}

/**
 * The en dash, which is the same tell wearing a narrower glyph.
 *
 * Banning the em dash moved the habit rather than ending it: a swap reply came
 * back with "the region your dish comes from – mustard for the east", which is
 * an em dash aside in all but codepoint. The prompt names one character, so the
 * model reached for the other.
 *
 * Only a spaced one is touched. Tight en dashes are ranges, and this project is
 * full of them: "8–12 hours", "28–32°C", "6–8 hours warm" are quoted out of the
 * swap records verbatim, and turning one into a comma would corrupt a ratio the
 * reader is meant to cook from. Spacing is what separates the two uses, and the
 * model spaces its asides because that is how an aside is written.
 */
export function stripEnDashes(text: string): string {
  return text.replace(/(?:[ \t]+–[ \t]*|[ \t]*–[ \t]+)/g, (match, offset: number, full: string) => {
    const next = full.charAt(offset + match.length);
    return !next || /[\s.,;:!?)\]]/.test(next) ? "" : ", ";
  });
}

/**
 * Markdown removal.
 *
 * The card styles its own text, so a literal `*` reaches the reader as
 * punctuation. The prompt says so in as many words and the model still emitted
 * emphasis on 6 of 15 restoration turns, almost always italicising a source
 * name or a transliterated dish.
 *
 * Asterisks are deleted outright rather than unwrapped in pairs. Nothing in
 * this prose has a legitimate use for one, and deleting a single character is
 * the only rewrite that cannot be split across a chunk boundary: `**Cauli` and
 * `flower:**` arriving separately still resolve to `Cauliflower:`. Pair
 * matching would need the whole document and would fail exactly when the model
 * left an emphasis unclosed.
 *
 * Underscores are unwrapped in pairs instead, since one can legitimately sit
 * inside a word.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // A bullet keeps its meaning, so it becomes the hyphen the prompt asks
      // for rather than vanishing into a ragged indent.
      .replace(/^[ \t]*[*+][ \t]+/gm, "- ")
      // Headings are styled by the card; the hashes are noise.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/\*/g, "")
      .replace(/(^|[\s("'])_([^_\n]+)_(?=$|[\s.,;:!?)"'])/g, "$1$2")
  );
}

/** Every rewrite, in the order they have to run. */
export function styleProse(text: string): string {
  return stripMarkdown(stripEnDashes(stripEmDashes(text)));
}

/**
 * The trailing run a rewrite could still be part of, which a streaming caller
 * has to hold back so it always sees the character that follows.
 *
 * Covers both dashes, and the markers that only mean something at a line start:
 * holding them back keeps `\n*` followed by `   Cauliflower` from losing its
 * bullet when the chunk splits between the two.
 *
 * The en dash is held for a second reason. Whether it is an aside or a range
 * turns on the spacing either side of it, so a chunk ending on "8–" must wait
 * for what follows before the rewrite can tell a ratio from a tell.
 */
export function danglingTail(text: string): number {
  return /[ \t—–*+#_]+$/.exec(text)?.[0].length ?? 0;
}
