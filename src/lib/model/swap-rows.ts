/**
 * The §SWAPS§ beat of an Indianisation card, parsed into rows.
 *
 * The model emits one component per line as `foreign :: indian :: reason`, and
 * this turns that into the table the card draws and the Then/Now the share
 * image carries. Both read the same rows, so what is downloaded is what was on
 * screen.
 *
 * It lives outside the component because the failures it handles are model
 * behaviour rather than rendering, and model behaviour is worth asserting
 * without a browser: `check-routing` exercises it directly.
 */
import { unbracket } from "@/lib/model/recipe-beat";

export interface SwapRow {
  foreign: string;
  indian: string;
  why: string;
}

/**
 * Words that differ between two phrasings of one swap and carry nothing else.
 * "whole-wheat / millet flatbread" and "whole-wheat or millet flatbread" are
 * the same row written twice.
 */
const JOINERS = new Set(["or", "and", "with", "a", "an", "the"]);

/** Identity of a swap, insensitive to wording, ordering and punctuation. */
function swapKey(indian: string): string {
  return indian
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !JOINERS.has(t))
    .sort()
    .join(" ");
}

export function parseSwapRows(text: string | undefined): SwapRow[] {
  const rows: SwapRow[] = [];
  const at = new Map<string, number>();

  for (const line of (text ?? "").split("\n")) {
    const parts = line.trim().split(/\s*::\s*/);
    // The same template habit the ingredient table has: the value substituted
    // correctly, the angle brackets left on around it.
    const foreign = unbracket(parts[0] ?? "");
    const indian = unbracket(parts[1] ?? "");
    // A line that does not parse is dropped rather than shown malformed.
    if (!foreign || !indian) continue;
    // The prompt states the row format as "<foreign part> :: <indian swap>",
    // and the model has copied that line through as data, with or without the
    // brackets. The table already renders those words as its header, so it
    // arrived as a second header sitting in the body.
    if (/^<?(foreign part|indian swap)>?$/i.test(foreign)) continue;

    const key = swapKey(indian);
    const seen = at.get(key);

    if (seen === undefined) {
      at.set(key, rows.length);
      rows.push({ foreign, indian, why: unbracket(parts[2] ?? "") });
      continue;
    }

    // Two foreign parts reaching the same Indian one is what a fusion looks
    // like when the model has answered it as two dishes: asked for a pizza and
    // a pasta, it maps `pizza base` and `pasta` to the same flatbread and
    // prints both, and the reader sees two dishes on a card that can only be
    // one. They are one component, so they become one row naming both parts.
    //
    // Merged rather than dropped: no swap map entry has the same Indian side
    // as another, so a collapse here means the model expanded one entry twice
    // — and if that is ever wrong, joining still shows everything it wrote.
    const row = rows[seen];
    const already = row.foreign
      .split(", ")
      .some((n) => n.toLowerCase() === foreign.toLowerCase());
    if (!already) rows[seen] = { ...row, foreign: `${row.foreign}, ${foreign}` };
  }

  return rows;
}
