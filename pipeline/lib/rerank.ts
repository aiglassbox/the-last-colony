import { env } from './env';
import { pinecone } from './pinecone';

/**
 * Cross-encoder reranking, behind a vendor seam.
 *
 * ## Why rerank at all
 *
 * The eval at 199 documents is what motivates this. Dense retrieval holds up
 * perfectly on names (devanagari, transliteration, english-name all 100%) and
 * falls apart on properties: ayurvedic queries sit at 60% Recall@1 dense, 100%
 * reranked.
 *
 * The cause is structural rather than a bad model. `buildEmbeddingText` puts a
 * whole recipe into one vector, so the one line naming a dish's ayurvedic
 * property competes against nine lines of ingredients and method. A bi-encoder
 * compresses the document once, in advance, with no idea which query is coming.
 * A cross-encoder reads query and document together, so the property line is
 * read in light of a question about properties. It is far too slow to run over
 * a whole corpus, which is exactly why it is a second stage.
 *
 * ## Why a seam
 *
 * The first implementation called Pinecone directly. Pinecone's hosted rerank
 * is capped at **500 requests per month across the whole organisation** on the
 * free plan, which an afternoon of evaluation exhausts and which no production
 * traffic could live inside. That is a hosting limit, not a model limit: the
 * model itself, `bge-reranker-v2-m3`, is Apache 2.0 and can be run anywhere.
 *
 * So vendor selection moved here, matching `provider.ts` — whichever key is
 * present wins, `RERANK_PROVIDER` forces a choice when several are. Switching
 * vendors is a line in `.env`, and self-hosting the open model later means
 * adding one more implementation rather than editing every caller.
 *
 * **Numbers do not transfer across vendors.** The 97% Recall@1 was measured
 * with `bge-reranker-v2-m3`. Re-run `npm run eval:rerank` after switching; a
 * quality claim carried across a vendor change is a claim nobody measured.
 */

export interface Reranked<T> {
  item: T;
  /** The cross-encoder's relevance score. NOT comparable to a cosine score. */
  score: number;
}

/** One scored document, by its position in the array that was sent. */
interface Scored {
  index: number;
  score: number;
}

/** Raised on a 429 so the retry layer can tell throttling from a real failure. */
class RateLimited extends Error {
  constructor(
    readonly vendor: string,
    detail: string,
  ) {
    super(`${vendor} rate limited: ${detail}`);
    this.name = 'RateLimited';
  }
}

/**
 * Retries a throttled call, and only a throttled one.
 *
 * Jina's free tier allows 100,000 tokens per minute, and one eval sweep is 216
 * reranks of twenty documents each — several times that, fired back to back. A
 * 429 there is not a failure, it is the caller going too fast, and treating it
 * as a failure silently degraded 43 of those queries to dense order and
 * reported the result as if reranking had happened.
 *
 * Waits are long because the limit is per minute: backing off two seconds just
 * spends the retry inside the same window. Everything else propagates
 * immediately — a bad key should fail now, not in forty seconds.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RateLimited) || attempt >= attempts - 1) throw error;
      const wait = 15_000 * 2 ** attempt;
      console.warn(`  rate limited, waiting ${wait / 1000}s (attempt ${attempt + 1}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

export interface Reranker {
  readonly vendor: 'pinecone' | 'jina' | 'cohere' | 'deepinfra';
  readonly model: string;
  /** Scores every document against the query; returns at most `topN`, ranked. */
  score(query: string, documents: string[], topN: number): Promise<Scored[]>;
}

/**
 * How many dense hits to rerank.
 *
 * The ceiling on what reranking can recover: a document dense retrieval never
 * returned cannot be reordered into the answer. Widening this costs latency and
 * tokens, not requests — every vendor here bills one call regardless of how
 * many documents it carries.
 */
export const RERANK_CANDIDATES = 20;

// --- Pinecone ---------------------------------------------------------------

/** Hosted `bge-reranker-v2-m3`. Free plan: 500 requests/month, org-wide. */
function pineconeReranker(): Reranker {
  const model = env.rerankModel ?? 'bge-reranker-v2-m3';
  return {
    vendor: 'pinecone',
    model,
    async score(query, documents, topN) {
      const response = await pinecone().inference.rerank(
        model,
        query,
        documents.map((text, i) => ({ id: String(i), text })),
        {
          topN: Math.min(topN, documents.length),
          returnDocuments: false,
          rankFields: ['text'],
          parameters: { truncate: 'END' },
        },
      );
      return (response.data ?? []).map((row) => ({
        index: Number(row.index),
        score: row.score ?? 0,
      }));
    },
  };
}

// --- Jina -------------------------------------------------------------------

/**
 * Jina. New keys carry 10M free tokens, which at this document size is roughly
 * 3,300 queries — enough to run the eval repeatedly, which is what it is here
 * for.
 *
 * Defaults to `jina-reranker-v3`, the current multilingual model (100+
 * languages, 0.6B parameters). If a key does not have access to it, set
 * `RERANK_MODEL=jina-reranker-v2-base-multilingual`, the previous generation —
 * `npm run rerank:check` will say plainly which one is answering.
 *
 * Plain `fetch` rather than an SDK: the request is a JSON body and a bearer
 * token, and a dependency for that is not worth the supply chain.
 */
function jinaReranker(): Reranker {
  const model = env.rerankModel ?? 'jina-reranker-v3';
  return {
    vendor: 'jina',
    model,
    score(query, documents, topN) {
      return withRetry(async () => {
        const response = await fetch('https://api.jina.ai/v1/rerank', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.jinaApiKey}`,
          },
          body: JSON.stringify({
            model,
            query,
            documents,
            top_n: Math.min(topN, documents.length),
          }),
        });
        if (response.status === 429) {
          throw new RateLimited('jina', (await response.text()).slice(0, 200));
        }
        if (!response.ok) {
          throw new Error(`jina rerank ${response.status}: ${(await response.text()).slice(0, 300)}`);
        }
        const body = (await response.json()) as {
          results?: Array<{ index: number; relevance_score: number }>;
        };
        return (body.results ?? []).map((r) => ({ index: r.index, score: r.relevance_score }));
      });
    },
  };
}

// --- Cohere -----------------------------------------------------------------

/**
 * Cohere. Trial keys allow 1,000 calls/month and are documented as
 * development-only; production is $0.001 per search, which at any plausible
 * traffic for this project is not the binding constraint.
 *
 * Defaults to `rerank-v3.5`, the id the API reference names for the `model`
 * field and the one the $0.001 figure was quoted against. Newer ids exist
 * (`rerank-v4.0-pro` appears in current examples) at pricing this has not
 * checked — set `RERANK_MODEL` to try one, and re-run the eval, because a
 * model change invalidates the measured numbers exactly as a vendor change does.
 */
function cohereReranker(): Reranker {
  const model = env.rerankModel ?? 'rerank-v3.5';
  return {
    vendor: 'cohere',
    model,
    score(query, documents, topN) {
      return withRetry(async () => {
        const response = await fetch('https://api.cohere.com/v2/rerank', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.cohereApiKey}`,
          },
          body: JSON.stringify({
            model,
            query,
            documents,
            top_n: Math.min(topN, documents.length),
          }),
        });
        if (response.status === 429) {
          throw new RateLimited('cohere', (await response.text()).slice(0, 200));
        }
        if (!response.ok) {
          throw new Error(
            `cohere rerank ${response.status}: ${(await response.text()).slice(0, 300)}`,
          );
        }
        const body = (await response.json()) as {
          results?: Array<{ index: number; relevance_score: number }>;
        };
        return (body.results ?? []).map((r) => ({ index: r.index, score: r.relevance_score }));
      });
    },
  };
}

// --- DeepInfra ---------------------------------------------------------------

/**
 * DeepInfra, hosting the Qwen3-Reranker family. Pay-per-token with no monthly
 * request cap, which is the property the other hosted options lack: Pinecone
 * stops dead at 500 requests a month and Jina throttles at 100k tokens a
 * minute. At roughly 3,000 tokens per rerank, Qwen3-4B works out near $0.08
 * per thousand queries.
 *
 * Its API is shaped differently from the others and the difference matters:
 * the model name is part of the URL, `queries` is an array even for one query,
 * and the response is a flat `scores` array **aligned to the order documents
 * were sent** rather than a ranked list. So the ranking is done here — index,
 * sort, truncate — instead of arriving pre-sorted.
 */
function deepinfraReranker(): Reranker {
  const model = env.rerankModel ?? 'Qwen/Qwen3-Reranker-4B';
  return {
    vendor: 'deepinfra',
    model,
    score(query, documents, topN) {
      return withRetry(async () => {
        const response = await fetch(
          `https://api.deepinfra.com/v1/inference/${model}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `bearer ${env.deepinfraApiKey}`,
            },
            body: JSON.stringify({ queries: [query], documents }),
          },
        );
        if (response.status === 429) {
          throw new RateLimited('deepinfra', (await response.text()).slice(0, 200));
        }
        if (!response.ok) {
          throw new Error(
            `deepinfra rerank ${response.status}: ${(await response.text()).slice(0, 300)}`,
          );
        }
        const body = (await response.json()) as { scores?: number[] };
        const scores = body.scores ?? [];
        if (scores.length !== documents.length) {
          // A misaligned array would silently attach every score to the wrong
          // document, which reads as a working reranker producing nonsense.
          throw new Error(
            `deepinfra returned ${scores.length} scores for ${documents.length} documents`,
          );
        }
        return scores
          .map((score, index) => ({ index, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topN);
      });
    },
  };
}

// --- selection --------------------------------------------------------------

/**
 * The reranker in use, or null when no key is set.
 *
 * Jina and Cohere are preferred over Pinecone by default, because Pinecone's
 * 500/month org-wide cap is the tightest of the three and is the one that
 * already ran out. `RERANK_PROVIDER` overrides.
 */
export function activeReranker(): Reranker | null {
  const forced = env.rerankProvider?.toLowerCase();

  if (forced === 'deepinfra') return env.deepinfraApiKey ? deepinfraReranker() : null;
  if (forced === 'jina') return env.jinaApiKey ? jinaReranker() : null;
  if (forced === 'cohere') return env.cohereApiKey ? cohereReranker() : null;
  if (forced === 'pinecone') return env.hasPineconeKey ? pineconeReranker() : null;
  if (forced === 'none') return null;

  // DeepInfra first: the only one here with no monthly request ceiling.
  if (env.deepinfraApiKey) return deepinfraReranker();
  if (env.jinaApiKey) return jinaReranker();
  if (env.cohereApiKey) return cohereReranker();
  if (env.hasPineconeKey) return pineconeReranker();
  return null;
}

/**
 * Reorders candidates by relevance to the query.
 *
 * Returns items in descending relevance. When no reranker is configured, or the
 * call fails, the dense order is preserved and the dense scores are kept: a
 * reranker that is down should degrade the ordering to "what dense retrieval
 * thought", never take the answer away. Retrieval declining is a product
 * decision made upstream, not something an outage gets to make.
 *
 * The failure is loud in the logs on purpose. Silent degradation here is a drop
 * from 97% to 88% Recall@1 that nothing on screen would reveal — which is
 * exactly how the Pinecone quota running out went unnoticed.
 */
export async function rerank<T>(
  query: string,
  candidates: Array<{ item: T; text: string; score: number }>,
  topN: number,
): Promise<Array<Reranked<T>>> {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return [{ item: candidates[0].item, score: candidates[0].score }];
  }

  const reranker = activeReranker();
  if (!reranker) {
    console.warn('  no reranker configured (set JINA_API_KEY or COHERE_API_KEY); dense order kept');
    return dense(candidates, topN);
  }

  try {
    const scored = await reranker.score(
      query,
      candidates.map((c) => c.text),
      topN,
    );
    const ranked = scored.flatMap((row) => {
      const candidate = candidates[row.index];
      return candidate ? [{ item: candidate.item, score: row.score }] : [];
    });
    if (ranked.length > 0) return ranked;
    console.warn(`  ${reranker.vendor} rerank returned no rows; dense order kept`);
  } catch (error) {
    console.warn(
      `  ${reranker.vendor} rerank failed, dense order kept: ` +
        `${error instanceof Error ? error.message : error}`,
    );
  }

  return dense(candidates, topN);
}

function dense<T>(
  candidates: Array<{ item: T; text: string; score: number }>,
  topN: number,
): Array<Reranked<T>> {
  return candidates.slice(0, topN).map((c) => ({ item: c.item, score: c.score }));
}
