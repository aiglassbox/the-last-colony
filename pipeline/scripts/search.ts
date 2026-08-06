/**
 * Search the corpus from the terminal. `npm run search -- "your question"`.
 *
 * The retrieval stack had no way in except through code. `rerank:check` proves
 * the reranker answers and `eval` scores a fixed gold set, but neither lets
 * someone type a question and look at what comes back — which is the first
 * thing anyone picking this up will want to do, and the fastest way to tell
 * whether the index holds what they think it holds.
 *
 * Prints both scores on purpose. The rerank score is what ordered the results;
 * the dense score is what found them. When those disagree the reranker is doing
 * its job, and seeing that happen is more convincing than the eval table.
 */
import 'dotenv/config';
import { activeReranker } from '../lib/rerank';
import { retrieve } from '../lib/retrieval';

const query = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();

if (!query) {
  console.error('\nUsage: npm run search -- "a dish that helps with digestion"\n');
  process.exit(1);
}

const topK = Number(process.argv.find((a) => a.startsWith('--top='))?.slice(6) ?? 5);
const reranker = activeReranker();

console.log(`\nquery:    "${query}"`);
console.log(`reranker: ${reranker ? `${reranker.vendor} / ${reranker.model}` : 'NONE — dense only'}`);

const hits = await retrieve(query, { topK });

if (hits.length === 0) {
  // Declining is a correct outcome here, not an error. Retrieval returns
  // nothing when the query is below threshold, which is the behaviour the
  // whole product is built around.
  console.log('\nNo match. Retrieval declined rather than returning a nearest neighbour.\n');
  process.exit(0);
}

console.log('');
for (const [i, hit] of hits.entries()) {
  const r = hit.recipe;
  console.log(`${i + 1}. ${r.name.english}  (${r.name.transliteration})`);
  console.log(`   id ${r.id}   rerank ${hit.score.toFixed(4)}   dense ${hit.denseScore.toFixed(3)}`);
  console.log(`   ${r.source.text}, ${r.source.period}`);
  if (r.properties.ayurvedic) console.log(`   ayurvedic: ${r.properties.ayurvedic}`);
  console.log(`   ingredients: ${r.ingredients.map((x) => x.modern_name).join(', ')}`);
  console.log('');
}
process.exit(0);
