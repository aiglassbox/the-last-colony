/**
 * Split a prose reply into paragraphs and comparison tables.
 *
 * A row is a line with two `::` separators, which is the shape the recipe table
 * already uses — one convention for "this is tabular", not a second one the
 * model has to remember.
 *
 * Only a comparison is a table: a run of rows whose first cell reads "Aspect",
 * which is how the prompt asks for one ('Aspect :: Then :: Now'). Any other
 * run is an ingredient list carried over from a card's table — asked for a
 * recipe again, the model writes the card's rows — and a table headed by its
 * first ingredient reads as nonsense, so each of those rows becomes a line of
 * its paragraph: "name, quantity: why".
 */
export type Block = { text: string; rows?: string[][] };

/** One ingredient row as a line of prose, skipping empty cells. */
export function rowAsLine(cells: string[]): string {
  const [name = "", qty = "", why = ""] = cells;
  const head = [name, qty].filter(Boolean).join(", ");
  return why ? (head ? `${head}: ${why}` : why) : head;
}

export function blocks(body: string): Block[] {
  const out: Block[] = [];
  let rows: string[][] = [];
  let para: string[] = [];

  const flushRows = () => {
    if (rows.length > 1 && /^aspect$/i.test(rows[0][0])) out.push({ text: "", rows });
    else for (const row of rows) para.push(rowAsLine(row));
    rows = [];
  };
  const flushPara = () => {
    const text = para.join("\n").trim();
    if (text) out.push({ text });
    para = [];
  };

  for (const line of body.split("\n")) {
    const cells = line.split("::").map((c) => c.trim());
    if (cells.length === 3 && cells.some(Boolean)) {
      // A comparison starts its own block; an ingredient run continues the
      // paragraph it sits in.
      if (/^aspect$/i.test(cells[0]) && !rows.length) flushPara();
      rows.push(cells);
      continue;
    }
    flushRows();
    if (!line.trim()) flushPara();
    else para.push(line);
  }
  flushRows();
  flushPara();
  return out;
}
