/**
 * The card sets its own typography, so model prose is rendered as plain text.
 * The prompt asks for no markdown and mostly gets it, but "mostly" is not a
 * renderer: one stray pair of asterisks and the reader sees *Mānasollāsa* with
 * the punctuation still attached. This strips the emphasis syntax rather than
 * interpreting it — nothing here needs bold.
 */
export function toPlainText(input: string): string {
  return (
    input
      // fenced and inline code
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/`([^`]+)`/g, "$1")
      // bold, italic, bold-italic — leaves intra-word underscores alone
      .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/(^|\s)_([^_\n]+)_(?=\s|[.,;:!?)]|$)/g, "$1$2")
      // headings and blockquotes at the start of a line
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      // list bullets — keep the text, drop the marker
      .replace(/^[ \t]*[-*+]\s+/gm, "")
      .trim()
  );
}
