# FLOW.md

How requests actually move through this codebase. Each section is one
pipeline; the last section shows how they connect (and where they
deliberately don't, yet).

---

## 1. Corpus build/validate flow — `npm run check`

This runs before anything else, on purpose: the corpus is the product, the
chatbot is the interface.

```
npm run check
  │
  ├─ corpus:validate       (scripts/validate-corpus.ts)
  │    loadCorpus() reads corpus/ancient, corpus/modern, corpus/swaps
  │    → validateRecord() / validateSwap()  (src/lib/corpus/validate.ts)
  │       per-record schema + cross-field rules:
  │         ATTESTED requires editor_verified
  │         unverified records must have null original_text/translation
  │         MODERN_DISH must not carry a source.locus
  │    → validateCorpusSet()  (cross-record)
  │       unique ids/slugs, modern_counterpart_id resolves,
  │       ancient records must have a counterpart, no alias collisions
  │    throws CorpusValidationError on any problem → exit 1
  │
  ├─ corpus:check-retrieval (scripts/check-retrieval.ts)
  │    runs all ~140 cases in tests/retrieval-queries.json through
  │    retrieveForDish() (src/lib/retrieval/retrieve.ts)
  │    WRONG answer or too many MISSes → exit 1
  │    also checks no corpus dish name collides with the foreign-dish veto
  │
  └─ check:routing         (scripts/check-routing.ts)
       pure logic checks, no network/model key: mode parsing, turn
       resolution, every text-cleanup pass in src/lib/model/*, rate
       limiting, slash commands, card copy
       any failing check → exit 1
```

A **wrong** retrieval answer is a build failure. A miss is a corpus gap (log
it, expand the corpus later); a wrong ancestor is a campaign risk (never
ship it).

---

## 2. The chat request — `POST /api/chat`

This is the central pipeline. Every other UI flow (dish permalink, follow-up
question, Indianisation) goes through this one route.

```
Chat.tsx: send(text, slug?)
  │  builds a user ChatMessage + an assistant placeholder (mode unset)
  │  POST /api/chat  { messages, activeRecordIds, slug }
  ▼
api/chat/route.ts
  │
  ├─ rate-limit check (checkRate + clientKey)         → 429 if exceeded
  ├─ parse + validate body                             → 400 if malformed
  ├─ parseCommand(text)  (src/lib/chat/commands.ts)
  │     strips a leading /slash-command, appends its instruction text
  │
  ├─ RETRIEVAL BRANCH
  │   │
  │   ├─ slug provided?  → retrieveBySlug(slug)   (permalink / QR code path)
  │   │
  │   └─ else            → retrieveForDish(query)  (src/lib/retrieval/retrieve.ts)
  │         1. foreign-dish veto   (namesForeignDish, checked first)
  │         2. BM25 keyword search over dish names/aliases only
  │         3. score threshold gate (MIN_KEYWORD_SCORE = 1.2)
  │              below threshold → fall back to repo.searchVectors()
  │              (→ bridges into pipeline/'s Pinecone index, see §6)
  │              but these become CANDIDATES, never a direct hit
  │         4. ambiguity gate (isAmbiguous)
  │              ≥2 hits, none explains_query, no unique head_phrase
  │              → decline rather than guess
  │         5. withCounterparts() — inject modern_counterpart_id records,
  │              capped at MAX_INJECTED_RECORDS = 3 top hits
  │
  ├─ isResolve = retrieval.empty && !slug
  │
  │   CORPUS HIT (!isResolve) — deterministic, no model needed for data
  │   │
  │   ├─ kind = "modern" if records[0].provenance_class === MODERN_DISH
  │   │         else "record"
  │   ├─ emit { type: "meta", mode: "restoration", kind, records }
  │   │     ← client can render the card's record half immediately,
  │   │       before the model has written a word
  │   ├─ renderCorpusBlock(records)  (src/lib/model/corpus-block.ts)
  │   │     serialises records into <corpus_records> prompt block;
  │   │     unverified records have locus/translation stripped
  │   └─ provider.streamText(SYSTEM_PROMPT, ...) → BeatParser
  │
  │   CORPUS MISS (isResolve) — model decides the turn kind
  │   │
  │   ├─ build <on_screen> (carried records) + <semantic_candidates> block
  │   ├─ prompt instructs model to open with MODE: REPLY|INDIANISE|MODERN|RESTORE
  │   ├─ provider.streamText(...) — first line parsed via parseResolved()
  │   │     (src/lib/chat/turn.ts)
  │   ├─ RESOLUTION map → { mode, kind }
  │   │     RESTORE  → promotes a semantic candidate to a real record
  │   │     INDIANISE→ renders <indianization_map> block instead, mode="indianize"
  │   │     MODERN   → component restoration, no ancient original
  │   │     REPLY    → plain prose, no card
  │   └─ emit meta + continue streaming
  │
  ▼
STREAMING PUMP (pump() closure, shared by both branches)
  │
  ├─ leak defense: hold LEAK_HOLD (120) chars before releasing anything,
  │     scan with findLeak() (src/lib/model/leak.ts) on every chunk
  │     → leak found: stop emitting, redact anything shown, emit LEAK_REFUSAL
  │
  ├─ sentence-boundary buffering: accumulate in `carry` until
  │     lastSentenceEnd() finds a boundary, then run the cleaning chain:
  │       styleProse → stripHealthClaims → stripProvenanceClaims
  │       → plainWords → restoreIndianWords → dropSelfAsPerson
  │       (+ dropNarration for prose turns)
  │
  ├─ beat parsing (restoration/indianize): BeatParser/MarkerParser
  │     splits on §MARKER§, emits { type: "delta", beat, text }
  │   prose (conversation/REPLY): emits { type: "text", text }
  │
  ├─ frame-refusal handling: a RESTORATION completion that only contains
  │     Indianisation markers (§REBUILD§/§SWAPS§/§PLATE§) gets re-declared
  │     mid-stream as mode:"indianize" — fresh meta + redact + reparse
  │
  └─ empty-output recovery: if nothing was emitted, re-declare as
        "conversation" and emit a generic "name a dish" fallback
  │
  ├─ auditProse() (src/lib/model/guards.ts) — tripwire only, logs
  │     [provenance-leak] if anything slipped through the cleaning chain
  │
  └─ always emit { type: "done" }, controller.close()
  ▼
Chat.tsx: reads NDJSON lines
  │  meta   → sets mode/kind/records on the message, updates activeRecordIds
  │  delta  → pushed into Typewriter, keyed by beat name
  │  text   → pushed into Typewriter, keyed by PROSE sentinel
  │  redact → cancels Typewriter, blanks text/beats
  │  error  → sets message.error
  ▼
Typewriter (src/lib/chat/typewriter.ts)
  │  paces already-arrived text at ~4 chars/frame (scaling up on backlog)
  │  onReveal() calls patchMessage() on every frame
  ▼
store.ts external store (useSyncExternalStore)
  │  update() skips localStorage write while streaming; flush() on turn end
  │  scheduleSync() → sync.ts debounces a push to /api/conversations (1.2s)
  ▼
Message.tsx dispatches on message.mode
  │  "restoration" → RestorationCard  (beats = model prose, records = citations)
  │  "indianize"   → IndianisationCard
  │  else          → ProseTurn (with inline comparison-table detection)
```

### Error paths (outer catch in `api/chat/route.ts`)

| Condition | Response |
|---|---|
| Request aborted (client navigated away / pressed stop) | Silent `controller.close()`, no error event |
| Quota exhausted (`asQuotaError`) | `{type:"error"}` with `retryAfterSeconds`, `[quota]` warned |
| Model refusal (`RefusalError`) | Generic "declined" error event |
| Anything else | Generic "could not be written" error event, `[chat]` logged |

Every branch still emits `done` before closing — the client's stream reader
always terminates cleanly.

---

## 3. Retrieval decision path in detail

Before `retrieveForDish` runs, a typed query passes through the language
normalize step, so the English keyword engine below always sees English:

```
POST /api/chat  (typed query, not a slug)
  │
  ├─ normalize(query)  (src/lib/lang/normalize.ts)
  │     one greedy (temperature 0) model call: detect language + return the
  │     dish name in its common English spelling
  │       "இட்லி" / "इडली" / "idli kaise banti hai"  →  "idli"
  │     single ASCII word → skipped (already English)
  │     unsupported (Urdu), low confidence, or any error → English fallback
  │       (reply English, retrieve on the untranslated string)
  │
  └─ retrieveForDish(normalized.english)   ← the English engine, unchanged
```

The echoed `label` stays the user's own words; only retrieval reads
`normalized.english`. A slug entry (QR / /dish/[slug]) skips normalize — a slug
is already canonical.

```
retrieveForDish(query)
  │
  ├─ namesForeignDish(query)?
  │     YES → return EMPTY (no candidates at all — a foreign-dish name
  │           must never carry an ATTESTED badge under an invented fusion)
  │
  ├─ Bm25Index.search(query)  (src/lib/retrieval/bm25.ts)
  │     tokenize() + phoneticFold() the query (src/lib/retrieval/normalize.ts)
  │     unknown-token veto: a doc is skipped unless it owns a full alias
  │       phrase that covers the unknown token
  │     score = Σ idf(term) × (K1+1)/(1+norm)  [+ phonetic at 0.6 weight]
  │     full-phrase match → score × 1.75
  │
  ├─ keyword[0].score < MIN_KEYWORD_SCORE (1.2)?
  │     YES → discard keyword result, call repo.searchVectors()
  │           results become `candidates` on an EMPTY result — never
  │           promoted to an answer without a model RESTORE verdict
  │
  ├─ isAmbiguous(hits)?
  │     ≥2 hits, none explains_query, ≥2 distinct ids, no unique
  │     head_phrase owner → decline (e.g. "vada pav")
  │
  ├─ reorder: promote the unique head_phrase hit to front if the top
  │     keyword hit doesn't explain_query
  │
  └─ withCounterparts(): cap at MAX_INJECTED_RECORDS (3), append each
        hit's modern_counterpart_id record (doesn't count against the cap)
```

Anything that declines logs `no_original_found` with a `[corpus-gap]`
prefix — that log is the corpus-expansion roadmap.

When retrieval declines *and* there's no semantic candidate either, the
`/api/chat` corpus-miss path injects the whole swap table
(`<component_swaps>`) instead, so the answer becomes a **component
restoration** rather than an apology.

---

## 4. Indianisation (Tier 3) flow

Triggered only from inside the corpus-miss / model-resolve path in
`/api/chat` — there is no separate route.

```
model declares MODE: INDIANISE (first line of completion)
  │  (foreign dish, e.g. pizza/pasta/burger — namesForeignDish() vetoed it
  │   from ever becoming a corpus hit upstream)
  ▼
renderIndianizationBlock(INDIANIZATION_RULES)  (src/lib/indianization/index.ts)
  │  builds <indianization_map> from rules.json — foreign component →
  │  Indian healthy substitute + technique swap, checked/authoritative
  ▼
model streams §VERDICT§ §REBUILD§ §SWAPS§ §PLATE§  (INDIANIZE_BEATS)
  │  parsed by the same MarkerParser<B>, different marker set
  ▼
IndianisationCard.tsx
  │  no provenance badge, no source strip (nothing citational exists)
  │  SWAPS beat → parseSwapRows() merges rows mapping to the same
  │    Indian substitute (e.g. "pizza base" + "pasta" both → flatbread)
  │  PLATE beat → parseRecipeBeat() + IngredientRows, same recordless
  │    rendering path RestorationCard's ModernRecipe uses
```

---

## 5. Ingredient swap flow — `POST /api/swap`

Independent of the chat thread; powers a standalone "pantry sheet" panel.

```
client → POST /api/swap { items: [...] }  (or GET → list all known swap items)
  │
  ├─ rate-limit check                          → 429 on refusal
  ├─ clamp: MAX_ITEMS=15, MAX_ITEM_CHARS=80, non-string entries dropped
  ├─ fileCorpus.findSwap(query) for each item, in parallel
  ├─ track "swap_requested" per item, "no_original_found" for misses
  │
  └─ if a provider is active:
        renderSwapBlock(item, record)  (src/lib/model/corpus-block.ts)
        provider.completeText(SWAP_SYSTEM_PROMPT, ...)   (non-streaming)
        sanitiseCompletion(raw, [], ctx)  (src/lib/model/sanitise.ts)
          — same cleaning chain as the streaming path, but composed for
            one-shot text; empty records[] makes the audit stricter
          on model error → note stays null, response still succeeds
```

---

## 6. Corpus repository ↔ pipeline bridge (the vector fallback)

This is the one place the two packages touch today.

```
src/lib/corpus/load.ts (fileCorpus.searchVectors)
  │
  ├─ VECTOR_FALLBACK === "off"?  → return []
  │
  └─ else: dynamic import of pipeline's retrieval module
        retrieve(query, {topK})  (pipeline/lib/retrieval.ts)
          embedQuery (Gemini) → Pinecone tier1-ancient top-20 → rerank
          → top 3–5 Recipe hits
        toCorpusRecord(recipe)  (src/lib/corpus/vector.ts)
          maps pipeline Recipe → app CorpusRecord
          provenance_class is conservatively capped at RECONSTRUCTED
          (never ATTESTED — that requires a rendered verse, which
           pipeline records don't carry)
        hits arrive with explains_query:false, head_phrase:false
          (so they can never silently pass the ambiguity gate as if
           they were a name match)
```

This bridge is read-only and one-directional: the app queries the
pipeline's Pinecone index; the pipeline never calls into the app. Nothing
else connects the two packages — `pipeline/`'s own `retrieve()` function is
otherwise unconsumed by any application code (documented as an open gap in
`pipeline/ARCHITECTURE.md`).

---

## 7. Pipeline package's own data flow (independent of the app)

```
pipeline/data/recipes.json  (Tier 1, 199 records, source of truth)
  │
  │  npm run sync   (pipeline/scripts/sync.ts)
  ▼
validate(recipes)
  │  id/slug uniqueness, required fields, metadata size ≤ 40KB
  ▼
fetchStoredHashes() — diff against what's already in Pinecone
  │  changed = content_hash mismatch or new id
  │  orphans = ids in the namespace but no longer in the JSON file
  ▼
embedDocuments(changed.map(buildEmbeddingText))   (pipeline/lib/embeddings.ts)
  │  Gemini gemini-embedding-001, 1536d, RETRIEVAL_DOCUMENT task type
  │  batched (50), L2-renormalized, 3-attempt retry with backoff
  ▼
namespaced(tier1-ancient).upsert(...)   (pipeline/lib/pinecone.ts)
  │  batched (50); orphans deleted from this namespace only
  ▼
Pinecone index "ancient-recipes", namespace tier1-ancient
  │  199 vectors, each carrying `tier` in metadata (belt-and-braces
  │  alongside the namespace boundary itself)

── query time ──────────────────────────────────────────────

query text
  │
  ▼
embedQuery(query)   (RETRIEVAL_QUERY task type)
  ▼
Pinecone top-20 (RERANK_CANDIDATES ceiling — reranking can only reorder
  │                what dense search already returned)
  ▼
activeReranker()   (pipeline/lib/rerank.ts)
  │  DeepInfra Qwen3-Reranker-4B first (no monthly cap), then Jina,
  │  Cohere, Pinecone/bge — or RERANK_PROVIDER forces one
  │  selection reads process.env — populated from ROOT .env for the app
  │  and pipeline/.env for pipeline scripts. Root .env must carry its own
  │  DEEPINFRA_API_KEY, else the app falls through to Pinecone/bge (500/mo cap)
  │  on failure/quota exhaustion → falls back to dense order, LOUDLY
  │  logged (this exact silent-degradation failure has happened twice)
  ▼
top 3–5 Hit[] { recipe, score (rerank), denseScore }
```

Evaluation and gold-set-maintenance scripts (`eval-embeddings.ts`,
`gold-review.ts`, `gold-audit.ts`, `gold-apply.ts`) form their own closed
loop around `pipeline/eval/gold-queries.json` — see EXPLANATION.md for what
each does; they don't sit in the production request path.

---

## 8. Conversation persistence flow

```
Every turn (send() in Chat.tsx)
  │
  ▼
store.ts: patchConversation / patchMessage
  │  update() writes to module state; SKIPS localStorage write while
  │  any message is mid-stream (avoid serializing every token)
  │  flush() force-writes when the turn ends
  ▼
localStorage["tlc.conversations.v1"]   (source of truth — device-local)
  │
  │  every write also calls scheduleSync() unconditionally
  ▼
sync.ts: debounced 1.2s → POST /api/conversations
  │  header x-device-id (localStorage UUID, "tlc.device.v1")
  │  keepalive: true; ALL failures silently swallowed
  ▼
api/conversations/route.ts → syncConversations()  (src/lib/db/conversations.ts)
  │  full-replace: upsert everything sent, delete anything not sent
  │  for that device_id
  ▼
Postgres `conversations` table   (server mirror — best-effort backup only)

── on load ──────────────────────────────────────────────────

hydrateFromServer()
  │  only runs if the CURRENT device has zero conversations with messages
  │  (device is source of truth; no merge-conflict handling by design)
  ▼
GET /api/conversations  →  listConversations(deviceId)
```

---

## 9. Launch-email tracking flow

Three routes write to one event log; one report reads it back.

```
Outlook mail-merge email (docs/kranti-launch-email.html, {{TID}} per contact)
  │
  ├─ reader clicks a CTA
  │     GET /r?c=ai|film|post&t=<tid>
  │       destination = destinationFor(code)   (fixed server-side map —
  │         a query-string URL is NEVER redirected to; this is the
  │         entire open-redirect defense)
  │       after(() => logEvent({kind:"click", tid, code, headers}))
  │       302 redirect fires immediately, logging happens after
  │
  ├─ email client renders the image (open tracking)
  │     GET /px.gif?t=<tid>
  │       after(() => logEvent({kind:"open", tid, code:null, headers}))
  │       serves a hardcoded 43-byte transparent GIF regardless
  │
  └─ reader clicks unsubscribe
        GET /unsubscribe?t=<tid>
          suppress(tid) called directly during render (awaited — this is
          the one place track.ts's "never throw" doctrine is relaxed,
          since the page must tell the truth about success/failure)
  │
  ▼
logEvent() / suppress()   (src/lib/email/track.ts)
  │  looksAutomated(userAgent) → is_automated flag (bot/proxy/scanner
  │    patterns; missing/short UA defaults to automated)
  │  fingerprint = sha256(salt|ip|ua) truncated to 24 chars — no PII,
  │    salt from TRACK_SALT or derived from DATABASE_URL
  │  insert; on isMissingTable() error → healSchema() (memoized,
  │    ensureEmailTables()) → retry once
  │  outer catch swallows everything (except suppress()'s return value)
  ▼
Postgres: email_events / email_suppressions
  │
  ▼
readReport(sql) + formatReport()   (src/lib/email/report.ts — shared)
  │
  ├─ CLI:   npm run email:report -- --sent 2000 [--tokens]
  │
  └─ HTTP:  GET /api/email-report?token=<EMAIL_REPORT_TOKEN>&sent=2000
              fails closed (404) if token unset or wrong — identical
              response either way, so probing can't confirm the route exists
              (timingSafeEqual compare)
```

---

## How the pipelines connect — summary

- **Corpus validation** (§1) gates everything else; it must pass before dev/deploy is trusted.
- **The chat request** (§2) is the spine. It calls into **retrieval** (§3) synchronously, and retrieval calls into the **pipeline bridge** (§6) only as a last-resort candidate source, never a direct hit.
- **Indianisation** (§4) is a mode *of* the chat request, not a separate pipeline — it shares the same route, streaming machinery, and card infrastructure, swapping only the prompt block and marker set.
- **Swap** (§5) is the one flow that doesn't touch retrieval or turn-mode routing at all — it's corpus lookup + optional model prose, independent of the conversation thread.
- **Conversation persistence** (§8) and **email tracking** (§9) are both write-through-to-Postgres side channels that degrade to no-ops if `DATABASE_URL` is unset — neither can ever block or break the chat/redirect/pixel response they're attached to.
- **The pipeline package's own sync/query loop** (§7) is currently the *only* fully-built path to the 199-record corpus, and the app reaches it through exactly one narrow, read-only bridge. Everything else in `pipeline/` (eval, gold-set tooling) is offline tooling that never runs in the request path.
