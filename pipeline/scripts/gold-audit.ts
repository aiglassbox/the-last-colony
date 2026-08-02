/**
 * Measures the gold set's shortlist bias. `npm run gold:audit`.
 *
 * The gold set was built from review sheets showing each query's top N
 * candidates, so it can only ever contain answers the retriever already ranked
 * highly. A valid answer at rank 40 was never shown and cannot be ticked.
 *
 * Note the direction, which is easy to get backwards. A *missing* answer cannot
 * inflate the score: if the retriever returns it first, the eval finds no
 * `expect` member at rank 1 and records a miss. Incompleteness therefore biases
 * recall **downward**. The upward risk is a different mechanism entirely —
 * ticking a marginal record *because* the retriever ranked it first, which is
 * rubber-stamping the system with its own output. Depth attacks the first;
 * only predicates independent of the ranking attack the second.
 *
 * This makes it known. For the queries that have an objective test — an
 * ingredient the record must list, an indication its ayurvedic field must
 * state — the predicate is run over **all 199 records**, not a shortlist. The
 * result is a ground truth that owes nothing to the retriever, so the gap
 * between it and the gold set is the bias, measured rather than assumed.
 *
 * Predicates are deliberately narrower than human judgement. They only fire on
 * evidence stated in the record, and they are checked in both directions: a
 * gold answer the predicate does NOT find is reported too, because that is
 * either a predicate that is too tight or an expectation that was wrong. Both
 * are worth seeing.
 *
 * Categories with no objective test (paraphrase, source-period) are skipped
 * rather than guessed at. Their bias stays unmeasured, and the report says so.
 */
import { readFile } from 'node:fs/promises';
import type { Recipe } from '../lib/types.js';

interface GoldQuery {
  category: string;
  q: string;
  expect: string[];
}

const recipes = JSON.parse(
  await readFile(new URL('../data/recipes.json', import.meta.url), 'utf8'),
) as Recipe[];
const gold = JSON.parse(
  await readFile(new URL('../eval/gold-queries.json', import.meta.url), 'utf8'),
) as GoldQuery[];

const ingredients = (r: Recipe) =>
  r.ingredients.map((i) => `${i.original} ${i.modern_name}`).join(' | ').toLowerCase();
const ayurveda = (r: Recipe) => (r.properties.ayurvedic ?? '').toLowerCase();
const title = (r: Recipe) =>
  `${r.name.english} ${r.name.transliteration} ${(r.aliases ?? []).join(' ')}`.toLowerCase();

/** query text → the evidence that makes a record a valid answer to it. */
const PREDICATES: Record<string, (r: Recipe) => boolean> = {
  'what did they cook in sesame oil': (r) => /sesame oil|gingelly/.test(ingredients(r)),
  'recipes made with buttermilk': (r) =>
    /buttermilk/.test(ingredients(r)) || /buttermilk/.test(title(r)),
  // "black gram" must not satisfy a bengal-gram query, so the alternatives are
  // spelled out rather than matched on a bare "gram".
  'anything made from bengal gram flour': (r) =>
    /bengal gram|chickpea flour|gram flour|besan|chana dal|vesana/.test(
      `${ingredients(r)} ${title(r)}`,
    ),
  'dishes using kokum': (r) => /kokum|malabar tamarind|garcinia/.test(ingredients(r)),
  'sweet dishes with cardamom and milk': (r) => {
    const i = ingredients(r);
    return /cardamom/.test(i) && /milk/.test(i) && /sugar|jaggery|syrup|honey/.test(i);
  },
  'something for bleeding disorders': (r) => /raktapitta|bleeding/.test(ayurveda(r)),
  'recipes that are good for hair': (r) => /hair/.test(ayurveda(r)),
  'food that helps with piles': (r) => /piles|arsha|haemorrhoid|hemorrhoid/.test(ayurveda(r)),
  // "Appetite stimulant" is the phrasing in several records and neither
  // "appetis" nor "appetiz" matches it. A predicate that misses the gold set's
  // own answers is measuring its own gaps, not the corpus.
  'what to eat when you have no appetite': (r) =>
    /appetis|appetiz|appetite|anorexia/.test(ayurveda(r)),
  'cooling foods for the body': (r) => /\bcold\b|cooling|refreshing/.test(ayurveda(r)),
  // Restricted to the dish's own name, and never a leaf dish. Searching the
  // ingredient list matched dhataki flowers used to ferment wine, blossoms used
  // to scent drinking water, and "Satapuspa" (dill, literally "hundred
  // flowers") whose edible part is the leaf. None is a flower cooked as a
  // vegetable, and all of them inflated the bias figure.
  'flowers that were cooked as vegetables': (r) =>
    /flowers?|buds?\b|puspa|pushpa|kusuma/.test(title(r)) && !/leaf|leaves/.test(title(r)),
};

const byId = new Map(recipes.map((r) => [r.id, r]));
/** `--write` emits an expanded copy for a sensitivity run. Never overwrites the gold set. */
const write = process.argv.includes('--write');
const expanded: GoldQuery[] = gold.map((g) => ({ ...g, expect: [...g.expect] }));

let totalHidden = 0;
let totalUnsupported = 0;
let audited = 0;

console.log(`\nAuditing ${Object.keys(PREDICATES).length} queries against all ${recipes.length} records\n`);

for (const g of gold) {
  const predicate = PREDICATES[g.q];
  if (!predicate) continue;
  audited++;

  const truth = recipes.filter(predicate).map((r) => r.id);
  const hidden = truth.filter((id) => !g.expect.includes(id));
  const unsupported = g.expect.filter((id) => !truth.includes(id));

  totalHidden += hidden.length;
  totalUnsupported += unsupported.length;

  if (write && hidden.length > 0) {
    const target = expanded.find((e) => e.category === g.category && e.q === g.q)!;
    target.expect = [...target.expect, ...hidden];
  }

  const flag = hidden.length > 0 ? '  ⚠' : '';
  console.log(
    `[${g.category}] "${g.q}"${flag}\n` +
      `   gold ${g.expect.length}  |  predicate finds ${truth.length}  |  ` +
      `missing from gold ${hidden.length}  |  gold-only ${unsupported.length}`,
  );
  for (const id of hidden) {
    const r = byId.get(id)!;
    console.log(`     + ${id.padEnd(34)} ${r.name.english}`);
  }
  for (const id of unsupported) {
    const r = byId.get(id)!;
    console.log(`     ? ${id.padEnd(34)} ${r.name.english}  (gold says yes, predicate says no)`);
  }
}

const goldAudited = gold
  .filter((g) => PREDICATES[g.q])
  .reduce((n, g) => n + g.expect.length, 0);

console.log(`\n${'='.repeat(70)}`);
console.log(`queries audited:            ${audited}`);
console.log(`accepted answers in gold:   ${goldAudited}`);
console.log(`valid answers gold misses:  ${totalHidden}`);
console.log(`gold answers unsupported:   ${totalUnsupported}`);
console.log(
  `\nshortlist bias: the gold set holds ${goldAudited} of ${goldAudited + totalHidden} ` +
    `answers a corpus-wide search finds (${((goldAudited / (goldAudited + totalHidden)) * 100).toFixed(0)}%).`,
);
console.log(
  `\nNot audited: paraphrase and source-period have no objective predicate, so\n` +
    `their bias is unmeasured. Treat this as a lower bound.`,
);
if (write) {
  const { writeFile } = await import('node:fs/promises');
  const out = new URL('../eval/gold-queries.expanded.json', import.meta.url);
  await writeFile(out, `${JSON.stringify(expanded, null, 2)}\n`, 'utf8');
  console.log('\nWrote eval/gold-queries.expanded.json (sensitivity run only).');
  console.log('Measure with: npx tsx scripts/eval-embeddings.ts --rerank --gold=gold-queries.expanded.json');
}
process.exit(0);
