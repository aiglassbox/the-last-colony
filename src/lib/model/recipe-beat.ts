/**
 * The recipe beat on a card that has no record behind it.
 *
 * Both recordless cards end on a model-written recipe — RESTORE_TODAY on a
 * modern dish or a corpus gap, PLATE on a foreign one — and both render it the
 * same way, so the parsing lives here rather than twice in two components.
 *
 * A record card teaches through its ingredient table: name, quantity, and why
 * it was there. The cards with no record — a modern dish, a corpus gap, a
 * foreign dish being rebuilt — had the same ingredients arriving as a flat
 * bullet list, so the column that does the teaching was missing on exactly the
 * turns where the reader most needs to know why one thing stands in for
 * another.
 *
 * The model already emits `foreign :: indian :: reason` for the swap table, so
 * ingredients use the same discipline: `ingredient :: quantity :: why`. Parsing
 * is deliberately forgiving. A line with one field is still an ingredient and
 * renders with empty cells rather than being dropped, because the alternative
 * is a card that silently loses half its recipe when the model writes a plain
 * list — and because mid-stream every line is briefly a one-field line.
 */

export interface IngredientRow {
  name: string;
  /** Empty when nothing was recorded. The prompt asks for empty over invented. */
  quantity: string;
  /** Why this one earns its place. Empty rather than fabricated. */
  why: string;
}

/**
 * The format line, copied through as data.
 *
 * The prompt states the row shape as `<ingredient> :: <quantity> :: <why this
 * one>`, and the model has been caught echoing that line into the body, with
 * and without its brackets. The table already renders those words as its
 * header, so an echo arrives as a second header sitting in the rows.
 */
const HEADER_ECHO = /^<?(ingredient|quantity|amount|why(\s+this(\s+one)?)?)>?$/i;

const BULLET = /^[-*•]\s*/;

/**
 * The template's angle brackets, kept around a real value.
 *
 * `HEADER_ECHO` above catches the format line copied through whole. This is the
 * other half of the same habit and the one that reaches the reader: the model
 * substitutes the ingredient correctly and leaves the brackets on, so a card
 * meant to be cooked from lists `<fresh coriander> :: 2 tbsp, chopped`. Every
 * row of a fusion card has come back that way. The prompt says to replace the
 * brackets and never reproduce them; this is what makes that true.
 *
 * Only a matched pair wrapping the whole field is stripped, so a stray `>` in
 * a quantity is left exactly as written.
 */
export function unbracket(field: string): string {
  const trimmed = field.trim();
  return /^<[^<>]+>$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}

/**
 * A reason that opens on a word which cannot open a clause, where what follows
 * it has lost the thing it referred to: "easier to digest than pulao" becomes
 * "than pulao", and the comparison is gone with the claim.
 */
const STRANDED_OPEN = /^(?:than|which|that|because|so)\b/i;

/**
 * A coordinating conjunction left at the front, which is the same residue with
 * the clause after it still intact: "aids digestion and adds a distinct
 * flavour" becomes "and adds a distinct flavour". Dropping the word recovers a
 * real reason that blanking the cell would have thrown away.
 */
const LEADING_CONJUNCTION = /^(?:and|or|but)\s+/i;

/**
 * Two prepositions with nothing between them, which is what a cut from the
 * middle of a short cell leaves: "for digestive balance with pulses" becomes
 * "for with pulses".
 */
const STRANDED_PAIR = /\b(?:for|with|of|to|in|on|by|from|than)\s+(?:for|with|of|to|in|on|by|from|than)\b/i;

/**
 * Trims a reason to its words, and to nothing when it no longer reads.
 *
 * The health pass upstream removes a claim and judges what survives against the
 * whole passage, which for a beat of ingredient rows is every row at once. A
 * cell is far shorter than that, so a cut it would wave through in a paragraph
 * can strip a cell down to its joining words and still clear the length test.
 * Here the cell is its own unit, and a cell reduced to prepositions is dropped:
 * this column already renders an empty cell for an ingredient with nothing
 * recorded, so a silence is a shape the table has, and word salad is not.
 */
function tidyReason(text: string): string {
  const trimmed = text
    .replace(/^[\s·,;:]+/, "")
    .replace(/[\s·,;:]+$/, "")
    .replace(/\s+(?:and|or|but|with)$/i, "")
    .replace(LEADING_CONJUNCTION, "")
    .trim();
  if (!/[a-z]/i.test(trimmed)) return "";
  if (STRANDED_OPEN.test(trimmed) || STRANDED_PAIR.test(trimmed)) return "";
  return trimmed;
}

/** True once the model has committed to the three-field shape. */
export function hasIngredientRows(lines: string[]): boolean {
  return lines.some((l) => l.includes("::"));
}

export function parseIngredientRows(lines: string[]): IngredientRow[] {
  const seen = new Set<string>();
  return lines
    .map((l) => l.trim().replace(BULLET, ""))
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s*::\s*/);
      return {
        name: unbracket(parts[0] ?? ""),
        quantity: unbracket(parts[1] ?? ""),
        // A reason the health pass has cut can come through as the punctuation
        // that used to join it to the rest, or as nothing at all. Either way the
        // cell is empty, and an empty cell is what should be drawn.
        why: tidyReason(unbracket(parts.slice(2).join(" · "))),
      };
    })
    .filter((r) => r.name && !HEADER_ECHO.test(r.name))
    // The same ingredient has come back twice in one list.
    .filter((r) => {
      const key = r.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * One ingredient as a single line.
 *
 * The 1080×1350 share image is a column of short strings with no room for a
 * third field, so the reason is dropped there rather than run on. Without this
 * the raw `a :: b :: c` line went onto the image with its separators showing.
 */
export function ingredientLabel(row: IngredientRow): string {
  return row.quantity ? `${row.name}, ${row.quantity}` : row.name;
}

export interface RecipeBeat {
  intro: string;
  /** Raw lines. Still unparsed so the caller can tell a list from a table. */
  ingredients: string[];
  steps: string[];
  outro: string;
}

/**
 * Structures a recordless recipe beat. The model writes an intro line, then an
 * INGREDIENTS block and a METHOD block; we parse those into the same list +
 * numbered-steps shape the ancient card renders from a record. The caller falls
 * back to plain prose if the model didn't use the sections.
 */
export function parseRecipeBeat(text: string): RecipeBeat {
  let section: "intro" | "ing" | "steps" = "intro";
  const intro: string[] = [];
  const ingredients: string[] = [];
  const steps: string[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const head = l.toUpperCase().replace(/[^A-Z]+$/, "");
    if (/^INGREDIENTS?$/.test(head)) {
      section = "ing";
      continue;
    }
    if (/^(METHOD|STEPS|DIRECTIONS)$/.test(head)) {
      section = "steps";
      continue;
    }
    if (section === "intro") intro.push(l);
    else if (section === "ing") ingredients.push(l.replace(BULLET, ""));
    else steps.push(l);
  }

  // A sentence at the end that carries no step number is the line about what
  // the result tastes like, not a step. Numbering it makes the reader look for
  // something to do in it.
  //
  // Only when the steps are numbered at all: a model that numbered none of them
  // wrote a plain list, and pulling its tail off would be reading a convention
  // that is not there.
  const numbered = steps.some((s) => /^\d+[.)]/.test(s));
  const outro: string[] = [];
  if (numbered) {
    while (steps.length > 1 && !/^\d+[.)]/.test(steps[steps.length - 1])) {
      outro.unshift(steps.pop()!);
    }
  }

  return {
    intro: intro.join(" "),
    ingredients,
    steps: steps.map((s) => s.replace(/^\d+[.)]\s*/, "")),
    outro: outro.join(" "),
  };
}
