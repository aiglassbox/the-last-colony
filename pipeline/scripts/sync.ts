/**
 * Pushes data/recipes.json into Pinecone. `npm run sync` (or `npm run sync:dry`).
 *
 * data/recipes.json stays the single source of truth; Pinecone is a derived
 * copy. The script is idempotent and keyed on each record's stable `id`:
 *   - unchanged recipes are skipped (content hash comparison, no re-embedding)
 *   - new/edited recipes are embedded and upserted
 *   - vectors whose id no longer appears in the JSON are deleted
 * So running it twice in a row is a no-op, and it is always safe to re-run.
 */
import { readFile } from 'node:fs/promises';
import { env } from '../lib/env';
import { embedDocuments } from '../lib/embeddings';
import { NAMESPACES, indexExists, namespaced, recipeIndex } from '../lib/pinecone';
import { buildEmbeddingText, buildMetadata, contentHash } from '../lib/recipe-text';
import type { Recipe } from '../lib/types';

const RECIPES_PATH = new URL('../data/recipes.json', import.meta.url);
const UPSERT_BATCH = 50;
const FETCH_BATCH = 100;

const dryRun = process.argv.includes('--dry-run');

const recipes = JSON.parse(await readFile(RECIPES_PATH, 'utf8')) as Recipe[];
validate(recipes);
console.log(`Loaded ${recipes.length} recipes from data/recipes.json`);

if (!(await indexExists(env.pineconeIndex))) {
  console.error(`Index "${env.pineconeIndex}" does not exist. Run: npm run index:setup`);
  process.exit(1);
}

// Scoped to Tier 1's namespace: this handle cannot read or delete a vector
// belonging to any other corpus, which is what makes the orphan deletion below
// safe once Tier 2 is loaded. See ARCHITECTURE.md.
const index = namespaced(NAMESPACES.tier1Ancient);

// Compare against what's already stored, so we only pay to embed what changed.
const storedHashes = await fetchStoredHashes(recipes.map((r) => r.id));
const changed = recipes.filter((r) => storedHashes.get(r.id) !== contentHash(r));
// Only ids inside tier1-ancient are visible here, so nothing outside this
// corpus can ever be classified as an orphan.
const orphans = [...(await listAllIds())].filter((id) => !recipes.some((r) => r.id === id));

console.log(
  `  ${changed.length} to upsert, ${recipes.length - changed.length} unchanged, ${orphans.length} to delete`,
);

if (dryRun) {
  for (const r of changed) console.log(`  + ${r.id}  ${r.name.english}`);
  for (const id of orphans) console.log(`  - ${id}`);
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

if (changed.length > 0) {
  console.log('Embedding…');
  const vectors = await embedDocuments(changed.map(buildEmbeddingText));

  const records = changed.map((recipe, i) => ({
    id: recipe.id,
    values: vectors[i],
    metadata: buildMetadata(recipe),
  }));

  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    await index.upsert(batch);
    console.log(`  upserted ${Math.min(i + batch.length, records.length)}/${records.length}`);
  }
}

if (orphans.length > 0) {
  await index.deleteMany(orphans);
  console.log(`  deleted ${orphans.length} removed recipe(s)`);
}

console.log(`\nSync complete — namespace "${NAMESPACES.tier1Ancient}".`);
// Stats are index-level, so this reads from the base handle, not the namespace.
const stats = await recipeIndex().describeIndexStats();
console.log(`  this namespace: ${stats.namespaces?.[NAMESPACES.tier1Ancient]?.recordCount ?? 0}`);
console.log(`  index total:    ${stats.totalRecordCount ?? 0}`);
for (const [name, ns] of Object.entries(stats.namespaces ?? {})) {
  console.log(`    ${name === '' ? '(default)' : name}: ${ns.recordCount}`);
}

// ---------------------------------------------------------------------------

/** Catches the schema mistakes that would otherwise surface as bad retrieval. */
function validate(all: Recipe[]): void {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [i, r] of all.entries()) {
    const where = r?.id ?? `record #${i}`;
    if (!r?.id) errors.push(`${where}: missing id`);
    else if (seen.has(r.id)) errors.push(`${where}: duplicate id`);
    else seen.add(r.id);

    if (!r?.name?.english) errors.push(`${where}: missing name.english`);
    if (!r?.source?.text) errors.push(`${where}: missing source.text`);
    // Every claim must be traceable — data/README.md makes source.url mandatory.
    if (!r?.source?.url) errors.push(`${where}: missing source.url`);
    if (!r?.ingredients?.length) errors.push(`${where}: no ingredients`);
    if (!r?.steps?.length) errors.push(`${where}: no steps`);

    const size = Buffer.byteLength(JSON.stringify(buildMetadata(r)));
    if (size > 40_000) errors.push(`${where}: metadata ${size}B exceeds Pinecone's 40KB limit`);
  }

  if (errors.length > 0) {
    console.error('Validation failed:');
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
}

/** id -> content_hash for records already in the index. */
async function fetchStoredHashes(ids: string[]): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    const { records } = await index.fetch(ids.slice(i, i + FETCH_BATCH));
    for (const [id, record] of Object.entries(records ?? {})) {
      const hash = record.metadata?.content_hash;
      if (typeof hash === 'string') hashes.set(id, hash);
    }
  }
  return hashes;
}

async function listAllIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let paginationToken: string | undefined;
  do {
    const page = await index.listPaginated(paginationToken ? { paginationToken } : {});
    for (const v of page.vectors ?? []) if (v.id) ids.add(v.id);
    paginationToken = page.pagination?.next;
  } while (paginationToken);
  return ids;
}
