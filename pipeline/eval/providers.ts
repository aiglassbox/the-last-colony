/**
 * Embedding candidates for the bake-off. Each provider embeds documents and
 * queries with whatever "this is a document" / "this is a query" hint its API
 * offers — that asymmetry is worth real accuracy, so skipping it would
 * understate every model here.
 *
 * A provider with no API key is skipped, not failed: run the eval with
 * whichever keys you have.
 */
import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';

export type Kind = 'doc' | 'query';

export interface Provider {
  id: string;
  note: string;
  available: boolean;
  embed(texts: string[], kind: Kind): Promise<number[][]>;
}

const BATCH = 32;

/** Cosine similarity assumes unit vectors; not every API guarantees them. */
export function normalize(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return magnitude > 0 ? v.map((x) => x / magnitude) : v;
}

async function inBatches(
  texts: string[],
  fn: (batch: string[]) => Promise<number[][]>,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await fn(texts.slice(i, i + BATCH))));
  }
  return out;
}

function gemini(): Provider {
  const key = process.env.GEMINI_API_KEY;
  const dim = Number(process.env.EMBEDDING_DIMENSION ?? 1536);
  let client: GoogleGenAI | null = null;

  return {
    id: `gemini-embedding-001 (${dim}d)`,
    note: 'Google, free tier; same SDK as the chat model',
    available: Boolean(key),
    async embed(texts, kind) {
      client ??= new GoogleGenAI({ apiKey: key! });
      return inBatches(texts, async (batch) => {
        const res = await client!.models.embedContent({
          model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
          contents: batch,
          config: {
            taskType: kind === 'doc' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
            outputDimensionality: dim,
          },
        });
        return (res.embeddings ?? []).map((e) => normalize(e.values ?? []));
      });
    },
  };
}

/** Pinecone's hosted inference — callable standalone, no index required. */
function pineconeE5(): Provider {
  const key = process.env.PINECONE_API_KEY;
  let client: Pinecone | null = null;

  return {
    id: 'multilingual-e5-large (1024d)',
    note: 'Pinecone-hosted; would remove the Gemini key entirely',
    available: Boolean(key),
    async embed(texts, kind) {
      client ??= new Pinecone({ apiKey: key! });
      return inBatches(texts, async (batch) => {
        const res = await client!.inference.embed('multilingual-e5-large', batch, {
          input_type: kind === 'doc' ? 'passage' : 'query',
          truncate: 'END',
        });
        return res.data.map((d) => normalize('values' in d ? (d.values as number[]) : []));
      });
    },
  };
}

function jinaV3(): Provider {
  const key = process.env.JINA_API_KEY;

  return {
    id: 'jina-embeddings-v3 (1024d)',
    note: 'Free tier, no credit card',
    available: Boolean(key),
    async embed(texts, kind) {
      return inBatches(texts, async (batch) => {
        const res = await fetch('https://api.jina.ai/v1/embeddings', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: 'jina-embeddings-v3',
            task: kind === 'doc' ? 'retrieval.passage' : 'retrieval.query',
            input: batch,
          }),
        });
        if (!res.ok) throw new Error(`Jina ${res.status}: ${await res.text()}`);
        const json = (await res.json()) as { data: { embedding: number[] }[] };
        return json.data.map((d) => normalize(d.embedding));
      });
    },
  };
}

export const PROVIDERS: Provider[] = [gemini(), pineconeE5(), jinaV3()];
