/**
 * What an earlier reply looks like when it is replayed to the model.
 *
 * History goes back so the model knows what it already said and does not repeat
 * itself. It went back verbatim, and a beat of `ingredient :: quantity ::
 * reason` rows replayed verbatim is a worked example sitting in the context
 * window — so whatever the last table did, the next one did again, and each
 * copy was saved and replayed in its turn.
 *
 * Measured on the same query against the same server, changing nothing but the
 * history: a clean thread averaged 5.1 words in the reason column, and the same
 * request behind one terse table averaged 3.2, with ten of twelve cells at
 * three words or fewer. The instruction sits in the final user turn, after the
 * history, and still lost to it. Formatting rules are stated once, in the
 * prompt; a thread that also demonstrates a format is arguing with them.
 *
 * Lives here rather than in the route so it can be exercised without a model
 * key and without a server, which is the same reason `swap-rows` moved out.
 */

/**
 * The first field of a line, if the line is a row at all. Null if it is prose.
 *
 * Containing "::" was once the whole test, which meant an ordinary sentence
 * carrying one was collapsed into an ingredient name and its meaning thrown
 * away. A row is a short line of two or three fields with no sentence inside
 * it, so that is what is checked.
 */
export function rowName(line: string): string | null {
  const trimmed = line.trim().replace(/^[-*•]\s*/, "");
  if (!trimmed.includes("::")) return null;
  const parts = trimmed.split(/\s*::\s*/);
  if (parts.length < 2 || parts.length > 3) return null;
  const first = parts[0].trim();
  // A field, not a clause. A row's first cell is an ingredient or a component.
  if (!first || first.length > 60 || /[.!?]/.test(first)) return null;
  // Nor is its second: a quantity, or the thing being swapped in. Only the
  // third may run to a clause, which is why the check lands here — "the ratio
  // you want is this :: one cup of maida becomes three quarters of a cup of
  // millet flour" opens with a short enough phrase to pass for a name, and
  // gives itself away by what follows the separator.
  if (parts[1].trim().length > 60) return null;
  return first;
}

/**
 * An earlier reply, with its ingredient and swap rows collapsed to names.
 *
 * The names survive because that is the part continuity actually needs: the
 * model has to know it already suggested sattu and ash gourd. What it does not
 * need is the shape it wrote them in.
 */
export function condenseRows(text: string): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(`(already suggested: ${run.join(", ")})`);
    run = [];
  };
  for (const line of text.split("\n")) {
    const name = rowName(line);
    if (name !== null) {
      if (name) run.push(name);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n");
}
