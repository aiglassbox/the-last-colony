/**
 * Embedding bake-off. `npm run eval` (add `--verbose` for per-query misses,
 * `--rerank` to measure the cross-encoder stage on top of each model).
 *
 * Ranking is a brute-force cosine loop in memory, so the vector DB is not a
 * variable in the experiment — this measures the embedding model in isolation.
 * That stays true with `--rerank`: reranking is a separate stage that reorders
 * a shortlist, and keeping the index out of it means the lift measured here is
 * the reranker's and not Pinecone's ANN recall.
 */
import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import { PROVIDERS, type Provider } from '../eval/providers.js';
import { buildEmbeddingText, buildRerankText } from '../lib/recipe-text.js';
import { rerank, RERANK_CANDIDATES } from '../lib/rerank.js';
import type { Recipe } from '../lib/types.js';

interface GoldQuery {
  category: string;
  q: string;
  expect: string[];
}

const verbose = process.argv.includes('--verbose');
const withRerank = process.argv.includes('--rerank');

const recipes = JSON.parse(
  await readFile(new URL('../data/recipes.json', import.meta.url), 'utf8'),
) as Recipe[];
// `--gold=<file>` swaps the answer key without touching the real one, so a
// sensitivity run cannot quietly become the baseline.
const goldFile =
  process.argv.find((a) => a.startsWith('--gold='))?.slice('--gold='.length) ??
  'gold-queries.json';
const gold = JSON.parse(
  await readFile(new URL(`../eval/${goldFile}`, import.meta.url), 'utf8'),
) as GoldQuery[];
if (goldFile !== 'gold-queries.json') console.log(`gold set: ${goldFile}`);

validateGold(recipes, gold);

const docTexts = recipes.map(buildEmbeddingText);
// The reranker reads a different, priority-ordered text — the same one
// `lib/retrieval.ts` sends. Measuring one and shipping the other made the
// reported lift not the delivered lift.
const rerankTexts = recipes.map(buildRerankText);
const docIds = recipes.map((r) => r.id);
const positives = gold.filter((g) => g.expect.length > 0);
const negatives = gold.filter((g) => g.expect.length === 0);

console.log(
  `${recipes.length} recipes | ${positives.length} positive queries | ${negatives.length} negative controls\n`,
);

const available = PROVIDERS.filter((p) => p.available);
for (const p of PROVIDERS.filter((p) => !p.available)) {
  console.log(`skipped  ${p.id} — no API key`);
}
if (available.length === 0) {
  console.error('\nNo providers available. Set at least one key in .env.');
  process.exit(1);
}

const results: Report[] = [];
for (const provider of available) {
  console.log(`\nrunning  ${provider.id} …`);
  try {
    results.push(await evaluate(provider, false));
  } catch (error) {
    console.error(`  FAILED: ${error instanceof Error ? error.message : error}`);
  }
  if (withRerank) {
    console.log(`running  ${provider.id} + rerank …`);
    try {
      results.push(await evaluate(provider, true));
    } catch (error) {
      console.error(`  FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }
}

if (results.length > 0) report(results);

// ---------------------------------------------------------------------------

interface Report {
  id: string;
  note: string;
  recall1: number;
  recall3: number;
  recall5: number;
  mrr: number;
  byCategory: Map<string, { recall1: number; recall3: number }>;
  maxNegative: number;
  worstPositiveTop: number;
  /** Same two quantities on the cross-encoder scale. -1 / 2 when not measured. */
  maxNegativeRerank: number;
  worstPositiveRerank: number;
  misses: string[];
  /** rank → how many queries landed there. Key 0 means "not in the shortlist". */
  rankHistogram: Map<number, number>;
  /** Right answer present but not first — the population R@1 work must convert. */
  nearMisses: string[];
}

async function evaluate(provider: Provider, useRerank: boolean): Promise<Report> {
  const docVectors = await provider.embed(docTexts, 'doc');
  const queryVectors = await provider.embed(
    gold.map((g) => g.q),
    'query',
  );

  let hits1 = 0;
  let hits3 = 0;
  let hits5 = 0;
  let rrSum = 0;
  let maxNegative = 0;
  let worstPositiveTop = 1;
  let maxNegativeRerank = -1;
  let worstPositiveRerank = 2;
  const categoryHits = new Map<string, { hit: number; top: number; total: number }>();
  const misses: string[] = [];
  const rankHistogram = new Map<number, number>();
  const nearMisses: string[] = [];

  for (const [i, g] of gold.entries()) {
    const dense = docVectors
      .map((v, j) => ({ id: docIds[j], score: dot(queryVectors[i], v) }))
      .sort((a, b) => b.score - a.score);

    // Rerank reorders the dense shortlist; anything dense never surfaced stays
    // unreachable, which is why the candidate window is wide.
    //
    // Computed before the negative-control branch on purpose: a junk query gets
    // reranked too, so its best rerank score can be compared against the worst
    // genuine one. Cosine cannot separate those two populations — "how do I
    // make pizza" outscores real matches — and whether a cross-encoder can is
    // the open question this measures rather than assumes.
    const ranked = useRerank
      ? (
          await rerank(
            g.q,
            dense.slice(0, RERANK_CANDIDATES).map((d) => ({
              item: d.id,
              text: rerankTexts[docIds.indexOf(d.id)],
              score: d.score,
            })),
            RERANK_CANDIDATES,
          )
        ).map((r) => ({ id: r.item, score: r.score }))
      : dense;

    // The two scales are tracked separately and never mixed: a cosine score and
    // a cross-encoder score share no units, and a threshold drawn across both
    // would be meaningless.
    if (g.expect.length === 0) {
      maxNegative = Math.max(maxNegative, dense[0].score);
      if (useRerank) maxNegativeRerank = Math.max(maxNegativeRerank, ranked[0].score);
      if (verbose) {
        console.log(
          `  neg  dense ${dense[0].score.toFixed(3)}` +
            (useRerank ? `  rerank ${ranked[0].score.toFixed(4)}` : '') +
            `  "${g.q}"`,
        );
      }
      continue;
    }

    const rank = ranked.findIndex((r) => g.expect.includes(r.id)) + 1; // 0 => not found
    if (rank === 1) hits1++;
    if (rank >= 1 && rank <= 3) hits3++;
    if (rank >= 1 && rank <= 5) hits5++;
    if (rank >= 1) {
      rrSum += 1 / rank;
      // Always the dense score, even on a rerank run: this feeds the threshold
      // report, which is a question about cosine. A rerank score here would be
      // compared against `maxNegative` on a scale it shares nothing with.
      const matched = ranked[rank - 1].id;
      const denseScore = dense.find((d) => d.id === matched)?.score ?? 0;
      worstPositiveTop = Math.min(worstPositiveTop, denseScore);
      // The rerank score of the record actually served. A usable cutoff has to
      // sit below this and above every junk query's best.
      if (useRerank) {
        worstPositiveRerank = Math.min(worstPositiveRerank, ranked[rank - 1].score);
      }
    }

    // Rank 0 is "never surfaced". Anything else is a ranking problem, and the
    // two need completely different fixes — recall work cannot help a document
    // that was already retrieved and merely placed second.
    rankHistogram.set(rank, (rankHistogram.get(rank) ?? 0) + 1);
    if (rank > 1) {
      const got = ranked[0].id;
      nearMisses.push(
        `rank ${rank}  [${g.category}] "${g.q}"  →  1st was ${got}, wanted ${g.expect.join('/')}`,
      );
    }

    const stat = categoryHits.get(g.category) ?? { hit: 0, top: 0, total: 0 };
    stat.total++;
    if (rank >= 1 && rank <= 3) stat.hit++;
    // Recall@1 per category. Recall@3 alone hid the thing that mattered: a
    // category can read 100% at three while never once placing the answer
    // first, and the reader only ever sees the first result.
    if (rank === 1) stat.top++;
    categoryHits.set(g.category, stat);

    if (rank < 1 || rank > 3) {
      misses.push(`[${g.category}] "${g.q}" → got ${ranked[0].id}, wanted ${g.expect.join('/')}`);
    }
  }

  const n = positives.length;
  return {
    id: useRerank ? `${provider.id} + rerank` : provider.id,
    note: provider.note,
    recall1: hits1 / n,
    recall3: hits3 / n,
    recall5: hits5 / n,
    mrr: rrSum / n,
    byCategory: new Map(
      [...categoryHits].map(([k, v]) => [
        k,
        { recall1: v.top / v.total, recall3: v.hit / v.total },
      ]),
    ),
    maxNegative,
    worstPositiveTop,
    maxNegativeRerank,
    worstPositiveRerank,
    misses,
    rankHistogram,
    nearMisses,
  };
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function report(all: Report[]): void {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(5);

  console.log('\n\n=== RESULTS ===\n');
  console.log('model'.padEnd(34) + 'R@1    R@3    R@5    MRR');
  for (const r of all) {
    console.log(
      r.id.padEnd(34) +
        `${pct(r.recall1)}  ${pct(r.recall3)}  ${pct(r.recall5)}  ${r.mrr.toFixed(3)}`,
    );
  }

  const categories = [...new Set(all.flatMap((r) => [...r.byCategory.keys()]))];
  console.log('\n--- By category, Recall@1 / Recall@3 ---\n');
  console.log('category'.padEnd(20) + all.map((r) => r.id.slice(0, 16).padEnd(18)).join(''));
  for (const c of categories) {
    console.log(
      c.padEnd(20) +
        all
          .map((r) => {
            const v = r.byCategory.get(c);
            return (v ? `${pct(v.recall1)} /${pct(v.recall3)}` : '        -').padEnd(18);
          })
          .join(''),
    );
  }

  console.log('\n--- Where the right answer landed ---\n');
  for (const r of all) {
    const h = r.rankHistogram;
    const at = (k: number) => h.get(k) ?? 0;
    const beyond = [...h].filter(([k]) => k > 3).reduce((n, [, v]) => n + v, 0);
    console.log(
      `${r.id.padEnd(40)} 1st ${String(at(1)).padStart(2)}  ` +
        `2nd ${String(at(2)).padStart(2)}  3rd ${String(at(3)).padStart(2)}  ` +
        `4th+ ${String(beyond).padStart(2)}  never ${String(at(0)).padStart(2)}`,
    );
    // The headline: how much R@1 is available without improving recall at all.
    const recoverable = at(2) + at(3);
    if (recoverable > 0) {
      const ceiling = (r.recall1 * positives.length + recoverable) / positives.length;
      console.log(
        `${''.padEnd(40)} ${recoverable} already in the top 3 but not first — ` +
          `reordering alone would reach R@1 ${(ceiling * 100).toFixed(0)}%`,
      );
    }
  }

  console.log('\n--- Thresholding: cosine ---\n');
  for (const r of all) {
    const clean = r.worstPositiveTop > r.maxNegative;
    console.log(
      `${r.id.padEnd(38)} worst relevant ${r.worstPositiveTop.toFixed(3)} | ` +
        `best nonsense ${r.maxNegative.toFixed(3)} | ` +
        (clean
          ? `separable — set minScore ≈ ${((r.worstPositiveTop + r.maxNegative) / 2).toFixed(2)}`
          : `OVERLAP — no threshold cleanly rejects junk queries`),
    );
  }

  // The same question asked of the cross-encoder. Cosine cannot separate a
  // recipe-shaped question about a dish we do not hold from a real one; whether
  // a rerank score can is what decides if declining can be a number rather than
  // only a prompt instruction.
  const reranked = all.filter((r) => r.maxNegativeRerank >= 0);
  if (reranked.length > 0) {
    console.log('\n--- Thresholding: cross-encoder ---\n');
    for (const r of reranked) {
      const clean = r.worstPositiveRerank > r.maxNegativeRerank;
      const gap = r.worstPositiveRerank - r.maxNegativeRerank;
      console.log(
        `${r.id.padEnd(38)} worst relevant ${r.worstPositiveRerank.toFixed(4)} | ` +
          `best nonsense ${r.maxNegativeRerank.toFixed(4)} | ` +
          (clean
            ? `SEPARABLE — gap ${gap.toFixed(4)}, cutoff ≈ ${((r.worstPositiveRerank + r.maxNegativeRerank) / 2).toFixed(4)}`
            : `overlap by ${(-gap).toFixed(4)}`),
      );
    }
  }

  if (verbose) {
    console.log('\n--- Misses (outside top 3) ---');
    for (const r of all) {
      console.log(`\n${r.id}`);
      if (r.misses.length === 0) console.log('  (none)');
      for (const m of r.misses) console.log(`  ${m}`);
    }

    console.log('\n--- Near misses (retrieved, but not first) ---');
    for (const r of all) {
      console.log(`\n${r.id}`);
      if (r.nearMisses.length === 0) console.log('  (none)');
      for (const m of r.nearMisses) console.log(`  ${m}`);
    }
  }

  const spread = Math.max(...all.map((r) => r.recall3)) - Math.min(...all.map((r) => r.recall3));
  if (all.length > 1 && spread < 0.05) {
    console.log(
      `\nNOTE: Recall@3 spread is only ${(spread * 100).toFixed(0)}pp across models — ` +
        `too close to call on quality at 24 recipes.\nDecide on operational grounds ` +
        `(fewer keys, fewer moving parts) rather than these numbers.`,
    );
  }
}

/** A gold set that points at a missing id would silently score as a miss. */
function validateGold(all: Recipe[], queries: GoldQuery[]): void {
  const ids = new Set(all.map((r) => r.id));
  const bad = queries.flatMap((g) => g.expect.filter((id) => !ids.has(id)).map((id) => `${g.q} → ${id}`));
  if (bad.length > 0) {
    console.error('Gold set references unknown recipe ids:');
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
}
