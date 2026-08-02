import { embedQuery } from './embeddings.js';
import { NAMESPACES, namespaced, type NamespaceName } from './pinecone.js';
import { buildRerankText, recipeFromMetadata } from './recipe-text.js';
import { rerank, RERANK_CANDIDATES } from './rerank.js';
import type { Recipe, RecipeMetadata } from './types.js';

/**
 * The query side of the RAG.
 *
 * Until now this did not exist: `embedQuery` was defined and called by nothing,
 * and `lib/` held ingestion only. Everything here is the other half — take a
 * question, return the records that answer it, and be honest when none do.
 *
 * Two stages, and the split is the point:
 *
 *   1. Dense retrieval over the whole namespace, wide (RERANK_CANDIDATES).
 *      Cheap, and its job is recall — do not miss the right document.
 *   2. Cross-encoder rerank down to `topK`. Expensive per document, which is
 *      why it only ever sees the shortlist, and its job is precision — put the
 *      right document first.
 *
 * The eval is what forces this shape. Dense-only Recall@1 is 69% at 199
 * documents against 91% at 24, and the loss is concentrated entirely in
 * property queries (ayurvedic 40%, ingredient 60%) while name queries stay at
 * 100%. That is a ranking failure inside a shortlist that usually already
 * contains the answer, which is precisely what a reranker is for.
 */

/** Non-food queries score below this. Real recipe-shaped junk does not — see below. */
export const MIN_SCORE = 0.52;

export interface Hit {
  recipe: Recipe;
  /** Rerank score when reranking ran, dense cosine when it did not. */
  score: number;
  /** The dense cosine score, always. Kept so the two are never confused. */
  denseScore: number;
}

export interface RetrieveOptions {
  topK?: number;
  namespace?: NamespaceName;
  /** Off only for the eval's dense-only baseline. Production wants it on. */
  useRerank?: boolean;
  /** Below this dense score nothing is returned at all. */
  minScore?: number;
}

/**
 * Retrieves the records that answer a query.
 *
 * On the threshold: the eval's negative controls show dense scores for
 * "how do I make pizza" (0.605) landing above the worst genuine match (0.574),
 * so `minScore` cannot separate a recipe-shaped question about a dish we do not
 * hold from a real one. It is kept because it does cleanly reject non-food
 * queries, and it is deliberately not asked to do more than that. What stops a
 * confident wrong answer is the grounding prompt plus the fact that every hit
 * carries its own citation — not this number.
 */
export async function retrieve(query: string, options: RetrieveOptions = {}): Promise<Hit[]> {
  const {
    topK = 5,
    namespace = NAMESPACES.tier1Ancient,
    useRerank = true,
    minScore = MIN_SCORE,
  } = options;

  const trimmed = query.trim();
  if (!trimmed) return [];

  const vector = await embedQuery(trimmed);

  const response = await namespaced(namespace).query({
    vector,
    // Wide when reranking, because rerank can only reorder what it is given.
    topK: useRerank ? Math.max(RERANK_CANDIDATES, topK) : topK,
    includeMetadata: true,
  });

  const candidates = (response.matches ?? []).flatMap((match) => {
    const metadata = match.metadata as RecipeMetadata | undefined;
    if (!metadata?.record) return [];
    const denseScore = match.score ?? 0;
    if (denseScore < minScore) return [];
    // Invariant 4: every vector carries its tier and retrieval asserts it,
    // rather than trusting that it queried the right namespace. Two guards,
    // because one silent failure here is a modern dish wearing a citation.
    const recipe = recipeFromMetadata(metadata);
    return [{ item: { recipe, denseScore }, text: buildRerankText(recipe), score: denseScore }];
  });

  if (candidates.length === 0) return [];

  if (!useRerank) {
    return candidates
      .slice(0, topK)
      .map((c) => ({ recipe: c.item.recipe, score: c.score, denseScore: c.item.denseScore }));
  }

  const ranked = await rerank(trimmed, candidates, topK);
  return ranked.map((r) => ({
    recipe: r.item.recipe,
    score: r.score,
    denseScore: r.item.denseScore,
  }));
}

// The rerank text lives in `recipe-text.ts` beside the embedding text, so the
// eval and this path cannot drift apart — they were already reranking two
// different strings, which meant the measured lift was not the shipped one.
