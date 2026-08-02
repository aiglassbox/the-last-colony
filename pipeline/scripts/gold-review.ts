/**
 * Builds a review sheet for the gold set. `npm run gold:review`.
 *
 * Why this exists: `eval/gold-queries.json` was written against the original
 * 24-record corpus, and every `expect` list still points only at those 24 (15
 * `ksk` + 9 `man`). The corpus is now 199. So the eval marks correct answers
 * wrong — it returned the Buttermilk record for "recipes made with buttermilk"
 * and scored zero, because the gold set has never heard of that record.
 *
 * That makes every number the eval reports an underestimate of unknown size,
 * and it makes tuning actively dangerous: optimising against this gold set
 * teaches the system to prefer the original 24 records over better matches from
 * the other 175. The metric would climb while the product got worse.
 *
 * So: retrieve candidates for every query, write them out with the evidence a
 * human needs to judge them, and pre-tick whatever is already expected. Ticking
 * a box is a claim that the record genuinely answers the query. `gold:apply`
 * reads the ticks back.
 *
 * Deliberately not automatic. "Is takra a valid answer for buttermilk" is
 * obvious; "is karambhaka genuinely cooling" requires reading the record's own
 * ayurvedic text, and a model guessing at that would relaunch the same problem
 * one layer down — a gold set nobody checked.
 */
import { readFile, writeFile } from 'node:fs/promises';
import 'dotenv/config';
import { PROVIDERS } from '../eval/providers.js';
import { buildEmbeddingText, buildRerankText } from '../lib/recipe-text.js';
import { rerank, RERANK_CANDIDATES } from '../lib/rerank.js';
import type { Recipe } from '../lib/types.js';

interface GoldQuery {
  category: string;
  q: string;
  expect: string[];
}

/**
 * How many candidates to put in front of the reviewer, per query.
 *
 * This number is the gold set's blind spot. A valid answer ranked below it is
 * never shown, so it can never be ticked, so it can never count as a miss —
 * which biases recall upward by however many such answers exist. `--depth=N`
 * widens the window precisely so that quantity can be measured instead of
 * assumed: review at depth 40, count how many genuine answers were hiding in
 * ranks 11-40, and the bias stops being unknown.
 */
const SHORTLIST = depthArg() ?? 10;

/** `--only=ayurvedic,ingredient` restricts the sheet to the named categories. */
const ONLY = onlyArg();

const OUT = new URL(
  SHORTLIST === 10 && !ONLY ? '../eval/gold-review.md' : '../eval/gold-review-deep.md',
  import.meta.url,
);

function depthArg(): number | null {
  const arg = process.argv.find((a) => a.startsWith('--depth='));
  if (!arg) return null;
  const n = Number(arg.slice('--depth='.length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--depth must be a positive integer, got "${arg}"`);
    process.exit(1);
  }
  return n;
}

function onlyArg(): Set<string> | null {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(
    arg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

const recipes = JSON.parse(
  await readFile(new URL('../data/recipes.json', import.meta.url), 'utf8'),
) as Recipe[];
const gold = JSON.parse(
  await readFile(new URL('../eval/gold-queries.json', import.meta.url), 'utf8'),
) as GoldQuery[];

const byId = new Map(recipes.map((r) => [r.id, r]));
const docTexts = recipes.map(buildEmbeddingText);
const rerankTexts = recipes.map(buildRerankText);
const docIds = recipes.map((r) => r.id);

const provider = PROVIDERS.find((p) => p.id.startsWith('gemini') && p.available);
if (!provider) {
  console.error('Needs GEMINI_API_KEY — the review shortlist comes from the shipped retriever.');
  process.exit(1);
}

const positives = gold
  .filter((g) => g.expect.length > 0)
  .filter((g) => !ONLY || ONLY.has(g.category));

if (positives.length === 0) {
  console.error(`No queries matched --only=${[...(ONLY ?? [])].join(',')}`);
  process.exit(1);
}

console.log(
  `${recipes.length} recipes | ${positives.length} queries | depth ${SHORTLIST}` +
    `${ONLY ? ` | categories: ${[...ONLY].join(', ')}` : ''}\n`,
);

console.log('embedding…');
const docVectors = await provider.embed(docTexts, 'doc');
const queryVectors = await provider.embed(
  positives.map((g) => g.q),
  'query',
);

const sections: string[] = [];
let alreadyTicked = 0;
let newCandidates = 0;

for (const [i, g] of positives.entries()) {
  process.stdout.write(`\r  reranking ${i + 1}/${positives.length}`);

  const dense = docVectors
    .map((v, j) => ({ id: docIds[j], score: dot(queryVectors[i], v) }))
    .sort((a, b) => b.score - a.score);

  // Rerank at least as many candidates as the sheet will show, or a deep review
  // would just be the shallow one padded with whatever dense ranked 11th.
  const window = Math.max(RERANK_CANDIDATES, SHORTLIST * 2);
  const ranked = await rerank(
    g.q,
    dense.slice(0, window).map((d) => ({
      item: d.id,
      text: rerankTexts[docIds.indexOf(d.id)],
      score: d.score,
    })),
    SHORTLIST,
  );

  const shortlist = ranked.map((r) => r.item);
  // An expected record the retriever did not surface still belongs on the
  // sheet: it may be a bad expectation rather than a bad retrieval, and
  // dropping it here would quietly delete that question.
  for (const id of g.expect) if (!shortlist.includes(id)) shortlist.push(id);

  const lines = [`### [${g.category}] ${g.q}`, ''];
  for (const id of shortlist) {
    const recipe = byId.get(id);
    if (!recipe) {
      lines.push(`- [ ] \`${id}\`  **MISSING FROM CORPUS** — remove this expectation`);
      continue;
    }
    const ticked = g.expect.includes(id);
    if (ticked) alreadyTicked++;
    else newCandidates++;

    const rank = ranked.findIndex((r) => r.item === id);
    const where = rank >= 0 ? `#${rank + 1}` : 'not retrieved';
    lines.push(
      `- [${ticked ? 'x' : ' '}] \`${id}\` · ${where} · **${recipe.name.english}**` +
        ` _(${recipe.name.transliteration})_`,
    );
    // The evidence for judging. Ayurvedic text is the field the hardest
    // category turns on, so it is never abbreviated.
    if (recipe.properties.ayurvedic) {
      lines.push(`      - ayurvedic: ${recipe.properties.ayurvedic}`);
    }
    if (recipe.properties.season) lines.push(`      - season: ${recipe.properties.season}`);
    if (recipe.properties.occasion) lines.push(`      - occasion: ${recipe.properties.occasion}`);
    lines.push(
      `      - ingredients: ${recipe.ingredients.map((x) => x.modern_name).join(', ')}`,
    );
    lines.push(`      - source: ${recipe.source.text}, ${recipe.source.period}`);
  }
  lines.push('');
  sections.push(lines.join('\n'));
}

process.stdout.write('\n');

const header = `# Gold-set review

Generated by \`npm run gold:review\`. Edit the ticks, then run \`npm run gold:apply\`.

**A ticked box means: this record genuinely answers this query.** Tick every
record that does, not just the best one — \`expect\` is a set of acceptable
answers, and Recall@1 counts a hit if *any* of them comes first.

Shortlist depth: **${SHORTLIST}**. Any rank above #10 is territory the original
depth-10 sheet could not see — a tick there is a measurement of the shortlist
bias, not just a correction.

Pre-ticked boxes are the current contents of \`eval/gold-queries.json\`. They are
not assumed correct: the current gold set only ever references the original 24
records (${recipes.length} exist now), so it both misses valid answers and may
contain expectations that a better record has since superseded. **Untick freely.**

\`#N\` is where the shipped retriever placed the record. It is context, not a
verdict — a record at #1 can be wrong and a record at #7 can be right. Judge the
record against the query, not against its rank.

Negative controls (\`expect: []\`) are excluded; they need no answers.

---

`;

await writeFile(OUT, header + sections.join('\n'), 'utf8');

console.log(`\nWrote eval/${OUT.pathname.split('/').pop()}`);
console.log(`  ${positives.length} queries`);
console.log(`  ${alreadyTicked} boxes pre-ticked (current gold set)`);
console.log(`  ${newCandidates} unticked candidates to judge`);
console.log(`\nEdit the ticks, then: npm run gold:apply`);
process.exit(0);

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
