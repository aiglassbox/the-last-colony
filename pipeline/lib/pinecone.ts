import { Pinecone, type Index } from '@pinecone-database/pinecone';
import { env } from './env';
import type { RecipeMetadata } from './types';

/**
 * One namespace per corpus. This is a safety boundary, not tidiness.
 *
 * Sync deletes vectors that no longer appear in its source file. If Tier 1 and
 * Tier 2 shared a namespace, a Tier-1 sync would see ~5,900 unrecognised ids
 * and delete every modern dish. Namespacing makes that impossible rather than
 * merely unlikely — a sync physically cannot see another corpus's vectors.
 *
 * See ARCHITECTURE.md.
 */
export const NAMESPACES = {
  tier1Ancient: 'tier1-ancient',
  tier2Modern: 'tier2-modern',
} as const;

export type NamespaceName = (typeof NAMESPACES)[keyof typeof NAMESPACES];

let client: Pinecone | null = null;

export function pinecone(): Pinecone {
  client ??= new Pinecone({ apiKey: env.pineconeApiKey });
  return client;
}

/** The whole index — use only for index-level operations such as stats. */
export function recipeIndex(): Index<RecipeMetadata> {
  return pinecone().index<RecipeMetadata>(env.pineconeIndex);
}

/**
 * A namespace-scoped handle. Every read, write, and delete in a sync must go
 * through this so it cannot reach another corpus.
 */
export function namespaced(ns: NamespaceName): Index<RecipeMetadata> {
  return recipeIndex().namespace(ns);
}

export async function indexExists(name: string): Promise<boolean> {
  const { indexes = [] } = await pinecone().listIndexes();
  return indexes.some((i) => i.name === name);
}
