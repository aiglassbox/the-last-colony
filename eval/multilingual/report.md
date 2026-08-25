# Multilingual retrieval — Path A vs Path B

**Path B (production):** `normalize(query).english` → `retrieveForDish` (BM25 keyword-first, the 132/132 engine). Exactly what a real request runs — the production `normalize` is imported, not re-implemented.
**Path A (benchmark):** raw multilingual query → `searchVectors` (cross-lingual Gemini embedding + Pinecone). No translation.

Scored on **consistency** (does the variant reach the same record its English form reaches, in that engine?) and **absolute** (consistent *and* the English anchor actually names the dish). See `run.ts` for why per-engine gold is required.

Total variant queries: **41** across 11 dishes and 8 language buckets.

| Path | Consistent | Absolute |
|---|---|---|
| A — raw → vector | 39/41 | 34/41 |
| B — translate → BM25 (production) | 41/41 | 41/41 |

> Path A's English anchor is the **wrong dish** for: poha, kheer, bedhai. The vector index retrieves a wrong record for these even in English, so their Path-A "consistency" is consistently-wrong and scores 0 absolute.

## By language (consistency)

| Lang | Path A | Path B |
|---|---|---|
| bn | 2/2 | 2/2 |
| gu | 2/2 | 2/2 |
| hi | 10/11 | 11/11 |
| hinglish | 5/6 | 6/6 |
| kn | 2/2 | 2/2 |
| roman | 11/11 | 11/11 |
| ta | 5/5 | 5/5 |
| te | 2/2 | 2/2 |

## By dish (absolute)

| Dish | Path A | Path B |
|---|---|---|
| idli | 8/8 | 8/8 |
| dosa | 6/6 | 6/6 |
| khichdi | 4/4 | 4/4 |
| poha | 0/3 | 3/3 |
| upma | 5/5 | 5/5 |
| rasam | 3/3 | 3/3 |
| vada | 3/3 | 3/3 |
| kheer | 0/2 | 2/2 |
| laddu | 2/2 | 2/2 |
| roti | 3/3 | 3/3 |
| bedhai | 0/2 | 2/2 |

## Where Path B (production) misses

_No Path-B misses._

Per-query detail (both paths, every row) is in `report.json`.
