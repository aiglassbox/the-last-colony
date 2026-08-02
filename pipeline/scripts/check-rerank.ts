/**
 * Is reranking actually working? `npm run rerank:check`.
 *
 * This exists because the failure it detects is invisible. `rerank()` degrades
 * to dense order when its vendor is unreachable, which keeps the product up but
 * quietly drops Recall@1 from 97% to 88% — and that is precisely how the
 * Pinecone quota running out went unnoticed for a whole session. Nothing on
 * screen changes. The only signal is a console line in a process nobody is
 * watching.
 *
 * So: name the vendor, make one real call, and check the answer is ordered the
 * way a working cross-encoder would order it. A configured key proves nothing —
 * the Pinecone key was valid the entire time it was refusing to serve.
 */
import 'dotenv/config';
import { activeReranker, rerank } from '../lib/rerank';

const reranker = activeReranker();

console.log('\nReranker');
console.log(`  vendor:  ${reranker?.vendor ?? 'NONE CONFIGURED'}`);
console.log(`  model:   ${reranker?.model ?? '—'}`);

if (!reranker) {
  console.error(
    '\n✗ No reranker configured. Retrieval runs dense-only: Recall@1 88% rather than 97%.\n' +
      '  Set one of JINA_API_KEY or COHERE_API_KEY in .env (or RERANK_PROVIDER=pinecone).\n',
  );
  process.exit(1);
}

// A probe whose correct answer is unambiguous, so a wrong order is a real
// failure rather than a debatable one. The decoys are food and share
// vocabulary with the query, because a probe that any keyword match would pass
// tests nothing about a cross-encoder.
const QUERY = 'a dish that cures piles and stimulates digestion';
const DOCS = [
  'Sweet fermented wine from sugarcane and jaggery. Intoxicating, pungent-bitter.',
  'Rice pudding with milk and sugar, served at the royal court.',
  'Elephant Foot Yam in Sesame Oil. Ayurvedic properties: stimulates digestion; light; cures piles and cough.',
  'Wheat flatbread made from dry wheat flour.',
];
const CORRECT = 2;

console.log(`\nProbe: "${QUERY}"`);

const ranked = await rerank(
  QUERY,
  DOCS.map((text, i) => ({ item: i, text, score: 1 - i * 0.01 })),
  DOCS.length,
);

for (const [position, r] of ranked.entries()) {
  const mark = r.item === CORRECT ? ' ←' : '';
  console.log(`  ${position + 1}. [doc ${r.item}] ${r.score.toFixed(4)}${mark}`);
}

const top = ranked[0]?.item;
if (top !== CORRECT) {
  console.error(
    `\n✗ Reranking is NOT working. Expected doc ${CORRECT} first, got ${top}.\n` +
      '  The dense order was passed through, which means the vendor call failed —\n' +
      '  scroll up for the reason. Retrieval is currently dense-only.\n',
  );
  process.exit(1);
}

// Dense order was deliberately seeded wrong (doc 0 highest), so the correct
// document reaching first can only have come from a real rerank.
const gap = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
console.log(`\n✓ Reranking works. Correct document first, ${gap.toFixed(4)} clear of second.\n`);
process.exit(0);
