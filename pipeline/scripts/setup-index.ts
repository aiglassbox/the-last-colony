/**
 * Creates the Pinecone serverless index. Run once: `npm run index:setup`.
 *
 * The dimension is baked in at creation time and cannot be changed — if you
 * switch embedding model or EMBEDDING_DIMENSION later, you must delete the
 * index and re-create it, then re-run sync.
 */
import { env } from '../lib/env.js';
import { indexExists, pinecone } from '../lib/pinecone.js';

const name = env.pineconeIndex;

if (await indexExists(name)) {
  const description = await pinecone().describeIndex(name);
  console.log(`Index "${name}" already exists.`);
  console.log(`  dimension: ${description.dimension}`);
  console.log(`  metric:    ${description.metric}`);
  if (description.dimension !== env.embeddingDimension) {
    console.error(
      `\nMISMATCH: index is ${description.dimension}-dim but EMBEDDING_DIMENSION is ${env.embeddingDimension}.` +
        `\nUpserts will fail. Either fix .env or delete and recreate the index.`,
    );
    process.exit(1);
  }
} else {
  console.log(`Creating index "${name}" (${env.embeddingDimension}-dim, cosine)…`);
  await pinecone().createIndex({
    name,
    dimension: env.embeddingDimension,
    metric: 'cosine',
    spec: {
      serverless: { cloud: env.pineconeCloud as 'aws' | 'gcp' | 'azure', region: env.pineconeRegion },
    },
    waitUntilReady: true,
  });
  console.log('Index ready. Now run: npm run sync');
}
