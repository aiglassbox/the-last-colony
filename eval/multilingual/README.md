# Multilingual retrieval eval — Path A vs Path B

Compares two ways to answer a non-English dish query, on the **real production
surface** (this eval lives in the root app so it imports the shipping code, not
a re-implementation):

- **Path B (production):** the app's own `normalize(query)` detects the language
  and returns the English dish name, then `retrieveForDish` runs the BM25
  keyword-first engine (the one the 132-query harness pins at 132/132). This is
  exactly what a live request does.
- **Path A (benchmark):** the raw multilingual query goes straight to
  `searchVectors` — the cross-lingual Gemini-embedding + Pinecone vector
  fallback — with no translation.

## How it is scored

The two engines return different records for the same dish (BM25 → the root
record `idli`; the vector index → the historical record `man-iddarika-012`,
named "…(medieval idli)"). Their id spaces do not overlap, so there is no single
shared gold. Each path is scored on:

- **Consistency** — does the language variant reach the same record the path's
  *own English query* reaches, in that path's engine?
- **Absolute** — consistent **and** the English anchor record actually names the
  dish. This catches an engine that is reliably wrong even in English (the vector
  index retrieves a barley-ball record for "poha"), which pure consistency hides.

## Running it

```bash
npm run eval:multilingual   # from repo root
```

Needs the model + retrieval keys already in the root `.env` (Gemini for
normalize + embeddings, Pinecone for the vector index). Writes `report.md` and
`report.json` here — both committed on purpose, since the recorded numbers are
the evidence for the production routing decision and belong in the PR.

## Query set

`queries.json` holds native-script variants harvested from the corpus records'
own `aliases` (authoritative spellings) or verified through
`corpus:check-multilingual`, plus authored romanized and Hinglish variants.
Distinctive dish tokens only — short ambiguous ones like "dal" are excluded so a
substring anchor check cannot false-match. Expand it with more dishes as
coverage grows; only add native strings you have confirmed, because a garbled
variant understates whichever path.
