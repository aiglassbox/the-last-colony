import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy .env.example to .env and fill it in.`);
  return v;
}

export const env = {
  get pineconeApiKey() {
    return required('PINECONE_API_KEY');
  },
  get pineconeIndex() {
    return process.env.PINECONE_INDEX ?? 'ancient-recipes';
  },
  get pineconeCloud() {
    return process.env.PINECONE_CLOUD ?? 'aws';
  },
  get pineconeRegion() {
    return process.env.PINECONE_REGION ?? 'us-east-1';
  },
  get geminiApiKey() {
    return required('GEMINI_API_KEY');
  },
  get embeddingModel() {
    return process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001';
  },
  get embeddingDimension() {
    return Number(process.env.EMBEDDING_DIMENSION ?? 1536);
  },

  // --- reranking ------------------------------------------------------------
  // Optional throughout: retrieval degrades to dense-only without a reranker
  // rather than failing, so none of these use `required()`. `hasPineconeKey`
  // exists because reranker selection must ask whether a key is present without
  // throwing when it is not.

  /** Forces a reranker: jina | cohere | pinecone | none. */
  get rerankProvider() {
    return process.env.RERANK_PROVIDER;
  },
  /** Overrides the chosen vendor's default model. */
  get rerankModel() {
    return process.env.RERANK_MODEL;
  },
  get jinaApiKey() {
    return process.env.JINA_API_KEY;
  },
  get cohereApiKey() {
    return process.env.COHERE_API_KEY;
  },
  get deepinfraApiKey() {
    return process.env.DEEPINFRA_API_KEY;
  },
  get hasPineconeKey() {
    return Boolean(process.env.PINECONE_API_KEY);
  },
};
