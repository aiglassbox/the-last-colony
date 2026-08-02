import { createHash } from 'node:crypto';
import type { Recipe, RecipeMetadata } from './types';

/**
 * One recipe = one chunk (per the blueprint: "chunk tight").
 *
 * The text is labelled section-by-section rather than dumped raw, so a query
 * like "what did they cook elephant foot yam in" can match the ingredient line
 * and a query like "12th century Deccan sweets" can match the source line.
 * Original Sanskrit terms are kept alongside modern names — Gemini embeddings
 * are multilingual, so a query in Devanagari or in transliteration both land.
 */
export function buildEmbeddingText(r: Recipe): string {
  const lines: string[] = [
    `Recipe: ${r.name.english}`,
    `Original name: ${r.name.original} (${r.name.transliteration})`,
    `Source: ${r.source.text} by ${r.source.author}, ${r.source.period}. ${r.source.citation}`,
    `Region: ${r.region}`,
    `Category: ${r.category}`,
    `Ingredients: ${r.ingredients
      .map((i) => `${i.original} (${i.modern_name}) — ${i.quantity}`)
      .join('; ')}`,
    `Preparation: ${r.steps.join(' ')}`,
  ];

  // Aliases greatly improve recall: a query for the common name ("idli", "kheer")
  // should land on the historical record ("iddarika", "payasa").
  if (r.aliases?.length) lines.splice(1, 0, `Also known as: ${r.aliases.join(', ')}`);

  if (r.properties.ayurvedic) lines.push(`Ayurvedic properties: ${r.properties.ayurvedic}`);
  if (r.properties.occasion) lines.push(`Occasion: ${r.properties.occasion}`);
  if (r.properties.season) lines.push(`Season: ${r.properties.season}`);
  if (r.notes) lines.push(`Notes: ${r.notes}`);

  return lines.join('\n');
}

/**
 * What the cross-encoder reads. Same record, different priorities.
 *
 * A bi-encoder sees the whole document and order barely matters. A reranker has
 * a hard input ceiling and truncates the tail, so order decides what survives.
 *
 * `buildEmbeddingText` appends properties *after* `Preparation`, the longest
 * field by far — which means `truncate: 'END'` cut the ayurvedic line off
 * exactly the records whose ayurvedic line was the reason to rerank them. That
 * ordering is fine for embedding and wrong for reranking, so this is a separate
 * function rather than a tweak to that one: reordering the embedding text would
 * change every content hash and force a full re-embed for no retrieval gain.
 *
 * Priority order here is what a query is most likely to be *about*:
 * identity, then properties, then provenance, then ingredients, and finally the
 * method — which is the least query-like text in the record and the right thing
 * to lose to truncation.
 */
export function buildRerankText(r: Recipe): string {
  const lines: string[] = [`${r.name.english} (${r.name.transliteration})`];

  if (r.aliases?.length) lines.push(`Also known as: ${r.aliases.join(', ')}`);

  // Ahead of everything bulky. These are one line each and carry the queries
  // dense retrieval is worst at.
  if (r.properties.ayurvedic) lines.push(`Ayurvedic properties: ${r.properties.ayurvedic}`);
  if (r.properties.occasion) lines.push(`Occasion: ${r.properties.occasion}`);
  if (r.properties.season) lines.push(`Season: ${r.properties.season}`);

  lines.push(`Source: ${r.source.text}, ${r.source.period}`);
  lines.push(`Region: ${r.region}. Category: ${r.category}`);
  lines.push(`Ingredients: ${r.ingredients.map((i) => i.modern_name).join(', ')}`);
  if (r.notes) lines.push(`Notes: ${r.notes}`);

  // Last, deliberately: longest, least query-like, first to be truncated.
  lines.push(`Preparation: ${r.steps.join(' ')}`);

  return lines.join('\n');
}

/** Flattens a recipe into Pinecone-legal metadata. See RecipeMetadata. */
export function buildMetadata(r: Recipe): RecipeMetadata {
  return {
    record: JSON.stringify(r),
    content_hash: contentHash(r),

    name_english: r.name.english,
    name_transliteration: r.name.transliteration,
    source_text: r.source.text,
    author: r.source.author,
    period: r.source.period,
    citation: r.source.citation,
    url: r.source.url,
    region: r.region,
    category: r.category,
    verification_status: r.verification_status,
    ingredients_modern: r.ingredients.map((i) => i.modern_name),
  };
}

/**
 * Fingerprint of the whole record, used by sync to skip unchanged recipes so
 * a re-run doesn't re-embed all 24 (and later, all 1000) every time.
 * Keys are sorted so incidental key-order churn in the JSON doesn't count as a change.
 */
export function contentHash(r: Recipe): string {
  return createHash('sha256').update(stableStringify(r)).digest('hex').slice(0, 32);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Parses the full recipe back out of a retrieved vector's metadata. */
export function recipeFromMetadata(meta: RecipeMetadata): Recipe {
  return JSON.parse(meta.record) as Recipe;
}
