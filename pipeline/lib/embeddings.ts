import { GoogleGenAI } from '@google/genai';
import { env } from './env';

let client: GoogleGenAI | null = null;
function genai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

/**
 * Task type matters for retrieval quality: documents and queries are embedded
 * into the same space but with different intent, so indexing must use
 * RETRIEVAL_DOCUMENT and searching must use RETRIEVAL_QUERY.
 */
type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

const BATCH_SIZE = 50;

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), 'RETRIEVAL_DOCUMENT')));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY');
  return vector;
}

async function embedBatch(texts: string[], taskType: TaskType): Promise<number[][]> {
  const response = await withRetry(() =>
    genai().models.embedContent({
      model: env.embeddingModel,
      contents: texts,
      config: { taskType, outputDimensionality: env.embeddingDimension },
    }),
  );

  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Embedding count mismatch: sent ${texts.length}, got ${embeddings.length}`);
  }

  return embeddings.map((e, i) => {
    const values = e.values;
    if (!values?.length) throw new Error(`Empty embedding returned for input ${i}`);
    if (values.length !== env.embeddingDimension) {
      throw new Error(
        `Model returned ${values.length} dimensions but EMBEDDING_DIMENSION is ${env.embeddingDimension}.`,
      );
    }
    // gemini-embedding-001 only returns a unit-length vector at its native
    // 3072 dimensions; truncated outputs must be renormalised before cosine
    // similarity is meaningful. Normalising an already-unit vector is a no-op.
    return normalize(values);
  });
}

function normalize(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return magnitude > 0 ? v.map((x) => x / magnitude) : v;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`  embedding call failed, retrying in ${delay}ms…`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
