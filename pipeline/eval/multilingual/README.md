# Multilingual retrieval eval — Path A vs Path B

Compares two ways to retrieve for a non-English query:

- **Path B (production):** detect + translate the query to English (the app's
  `normalize` step, duplicated here as a small local prompt because the pipeline
  package cannot import from `src/`), then embed the English string and retrieve.
- **Path A (benchmark):** embed the raw multilingual query directly with the
  Gemini embedding model and retrieve from the vector index — no translation.

Both paths run against the same Pinecone index and the same reranker, so the
only variable is whether the query was translated first.

Gold is anchored to the English name: for each dish, the English query defines
the correct record, and each language variant is scored on whether it reaches
the same record.

Run: `npm run eval:multilingual` (from `pipeline/`). Needs a Gemini key.
Outputs `report.md` and `report.json` here (both git-ignored; regenerate).

`queries.json` is a starter set (idli, khichdi across all 8 languages, dosa on a
verified subset). Expand it with more dishes and verified native-script spellings
as coverage grows — a garbled variant understates Path B unfairly, so only add
strings you have confirmed.
