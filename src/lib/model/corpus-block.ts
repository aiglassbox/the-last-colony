import type { CorpusRecord, SwapRecord } from "@/lib/corpus/types";

/**
 * Serialises retrieved records into the `<corpus_records>` block.
 *
 * Two things are deliberate. First, unverified records are shipped to the model
 * with their locus stripped and an explicit instruction not to cite — the model
 * cannot leak a page number it was never given. Second, the block is compact
 * prose rather than raw JSON: the model writes the prose beats and the client
 * renders the structured parts, so shipping the full JSON would just invite it
 * to restate tables it is not supposed to write.
 */

function line(label: string, value: string | null | undefined): string {
  return value ? `${label}: ${value}\n` : "";
}

export function renderRecord(r: CorpusRecord): string {
  const verified = r.verification.status === "editor_verified";
  const parts: string[] = [];

  parts.push(`<record id="${r.id}" tier="${r.tier}" provenance="${r.provenance_class}">`);
  parts.push(line("dish", r.dish_name_modern));
  parts.push(line("source_name", r.dish_name_source));
  parts.push(line("region", r.region));

  if (r.provenance_class !== "MODERN_DISH") {
    parts.push(line("text", r.source.text));
    parts.push(line("author", r.source.author));
    parts.push(line("century", r.source.century));
    if (verified) {
      parts.push(line("locus", r.source.locus));
      parts.push(line("edition", r.source.edition));
      parts.push(line("translation", r.translation));
    } else {
      parts.push(
        "citation_status: NOT YET VERIFIED against the printed edition. The " +
          "locus and page are withheld from you on purpose. Refer to the text " +
          "in words if you must, never with a chapter, verse, edition or page. " +
          "Nothing in this record is attested — do not describe it as attested, " +
          "proven, confirmed, or documented.\n",
      );
    }
  }

  if (r.ingredients.length) {
    parts.push("ingredients:\n");
    for (const i of r.ingredients) {
      const sk = i.sanskrit ? ` (${i.sanskrit})` : "";
      const qty = i.quantity_modern ? `, ${i.quantity_modern}` : "";
      parts.push(`  - ${i.name}${sk}${qty} — ${i.function}\n`);
    }
  }

  if (r.method_reconstructed.length) {
    parts.push("method:\n");
    r.method_reconstructed.forEach((s, i) => parts.push(`  ${i + 1}. ${s}\n`));
  }

  if (r.contested_points.length) {
    parts.push("contested:\n");
    for (const c of r.contested_points) parts.push(`  - ${c}\n`);
  }

  if (r.substitution_story) {
    parts.push("what_changed:\n");
    for (const c of r.substitution_story.changed) {
      parts.push(`  - ${c.from} → ${c.to} (${c.period}); driver: ${c.driver}\n`);
    }
    const delta = Object.entries(r.substitution_story.nutrition_delta)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    if (delta) parts.push(`  nutrition_delta (comparative only): ${delta}\n`);
  }

  if (r.restore_today) {
    parts.push(`restore_today (${r.restore_today.time_min} min):\n`);
    for (const i of r.restore_today.ingredients) parts.push(`  - ${i}\n`);
    r.restore_today.steps.forEach((s, i) => parts.push(`  ${i + 1}. ${s}\n`));
  }

  parts.push(`vitalife_relevance: ${r.vitalife_relevance}\n`);
  parts.push("</record>");

  return parts.join("");
}

export function renderCorpusBlock(records: CorpusRecord[]): string {
  if (!records.length) {
    return (
      "<corpus_records>\n" +
      "EMPTY. Retrieval found no record above threshold for this query. Say the " +
      "dish is not in the restored corpus yet. Do not name a text, a century, or " +
      "an original ingredient list. Do component restoration instead, using the " +
      "<component_swaps> below for every ratio you quote.\n" +
      "</corpus_records>"
    );
  }
  return `<corpus_records>\n${records.map(renderRecord).join("\n\n")}\n</corpus_records>`;
}

/**
 * The swap table, injected when retrieval finds nothing.
 *
 * Component restoration is the answer for every dish the corpus does not have,
 * and it is only as good as the ratios behind it. Handing the model the real
 * swap records means "use hung curd or a ground kabuli chana paste instead of
 * cream" arrives with a usable quantity attached, rather than being invented
 * on the spot — a fabricated ratio is the same class of failure as a
 * fabricated verse, just quieter.
 */
export function renderComponentSwaps(swaps: SwapRecord[]): string {
  if (!swaps.length) return "";
  const body = swaps
    .map((s) => {
      const opts = s.options
        .map(
          (o, i) =>
            `    ${i + 1}. ${o.swap}\n` +
            `       ratio: ${o.ratio}\n` +
            `       taste_and_texture: ${o.taste_and_texture}\n` +
            `       nutritional_rationale: ${o.nutritional_rationale}\n`,
        )
        .join("");
      return `  <swap item="${s.modern_item}">\n${opts}       where_it_went: ${s.where_it_went}\n  </swap>`;
    })
    .join("\n");

  return (
    "<component_swaps>\n" +
    "These are the substitutions you may quote. Use their ratios verbatim; do " +
    "not invent a ratio that is not here, and do not claim a swap wins on an " +
    "axis this table does not name.\n" +
    `${body}\n` +
    "</component_swaps>"
  );
}

export function renderSwapBlock(item: string, record: SwapRecord | null): string {
  if (!record) {
    return (
      `<swap_records item="${item}">\n` +
      "EMPTY. No swap record for this item. Say so plainly rather than " +
      "improvising a ratio.\n" +
      "</swap_records>"
    );
  }
  const opts = record.options
    .map(
      (o, i) =>
        `  ${i + 1}. ${o.swap}\n` +
        `     ratio: ${o.ratio}\n` +
        `     taste_and_texture: ${o.taste_and_texture}\n` +
        `     nutritional_rationale: ${o.nutritional_rationale}\n`,
    )
    .join("");
  return (
    `<swap_records item="${record.modern_item}">\n` +
    `${opts}  where_it_went: ${record.where_it_went}\n` +
    "</swap_records>"
  );
}
