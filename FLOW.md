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
  │   CORPUS MISS (isResolve) — community, then the model, decides the turn
  │   │
  │   ├─ serveCommunity(label, region, lang)  (api/chat/route.ts)
  │   │     checked FIRST — before the carried records are gathered and
  │   │     before the resolve prompt below is built, so a hit costs no
  │   │     prompt construction and no model call. Match mechanics in §3.
  │   │     HIT  → emits its own meta{mode:"community", kind:"community",
  │   │              records:[], community: card} + text + done, and the
  │   │              route returns here — nothing below this bullet runs.
  │   │              The `text` event is communityText(card), a plain-text
  │   │              rendering never shown on screen (CommunityCard draws
  │   │              the turn from `meta.community`) — its only job is to be
  │   │              what a follow-up's replayed history carries back in.
  │   │     MISS → matchCommunity returned null (no store, no matches, or a
  │   │              caught query error) → fall through
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

`normalized` also carries the language and register, which become the reply
instruction threaded into whichever turn the route builds:

```
langRule = replyInstruction(normalized)   (src/lib/lang/reply-instruction.ts)
  │   "reply in Tamil, native script" / "reply in Hinglish, Latin letters"
  │   fallback (Urdu, low confidence) → "reply in English" + supported-langs line
  │
  ├─ corpus-hit RESTORATION turn  → …${directive}${langRule}\n\nUser said: …
  └─ resolve (MODE-declaring) turn → … + directive + langRule + "\n\nUser said: …"
```

Appended after `directive` like `PLAIN_WORDS`, so the reply is authored in the
reader's language while the card structure and every content gate stay unchanged.
A slug entry has no detected language, so `langRule` is empty and it replies in
English.

The record-derived half of the card is localized the same turn, from data rather
than the model. On a non-English hit the route reads the precomputed localized
card and rides it along on the `meta` event:

```
loadLocalized(record, lang)   (src/lib/lang/localized-store.ts)
  │   reads corpus/localized/<lang>/<slug>.json — a file, no model call
  │   null on a missing/stale file → the card renders the English record
  │
  └─ emit meta { records, lang, localized }   → client stores it on the message
                                              → RestorationCard renders it, per-field English fallback
```

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

Before the model gets a turn at all, a corpus miss checks whether a reader's
own family already sent this dish in. This is the retrieval tier added since
community submissions shipped: corpus record → **published community
submission** → model. It is the only insertion point — inside the corpus-hit
branch, a completion can still withdraw its own record mid-stream
(`§NO_ANCESTOR§`, a modern-namesake match, see §2's `pump`), but that
callback runs synchronously, mid-parse, and cannot `await` an Atlas query, so
a community lookup never runs there; probing a hit into that branch would
mean paying for one on every corpus hit to cover a case that mostly never
happens.

```
isResolve (retrieval.empty && !slug)
  │
  └─ serveCommunity(label, region, readerLang)   (api/chat/route.ts)
        │
        └─ matchCommunity(query, region, readerLang)  (src/lib/community/client.ts)
              │
              ├─ normalizeDish(query) empty?  → decline, no Atlas round trip
              │
              ├─ Atlas: submissions where status:"green" AND published_at
              │     exists AND dish.tag exists/non-empty, sorted
              │     published_at desc, maxTimeMS 2000, limit 200
              │     (ponytail: in-memory phrase filter over that page — an
              │     aliases-array index is the upgrade if the store outgrows it)
              │
              ├─ phraseMatches(normalizedQuery, dish.tag, dish.aliases)
              │     (src/lib/community/match.ts) — in memory, over the page
              │     above. The normalized query must EQUAL, or CONTAIN as a
              │     phrase bounded by string start/end or a space, the tag or
              │     one alias. Walked with indexOf and explicit boundary
              │     checks, never a constructed RegExp — a stored alias is
              │     model output from a document a member of the public
              │     submitted, and new RegExp(alias) would hand that text the
              │     regex engine.
              │
              └─ pickCommunity(matches, region, readerLang)  (match.ts)
                    three rules, each filtering what the last left; only the
                    third chooses (matches already sort published_at desc,
                    so "the first survivor" is always "the most recent"):
                      1. stateForRegion(region) — Vercel's
                         x-vercel-ip-country-region mapped through
                         REGION_TO_STATE to a full state name — narrows to
                         rows whose submission.state matches
                      2. narrows further to rows whose dish.language matches
                         the reader's detected language (skipped entirely
                         when detection fell back, rather than guess one)
                      3. most recently published
```

`lookup`'s three ways of declining — an empty match list, a null store (unset
env, or a connection failure `communityDb()` already caught), and a thrown
error from the query itself — all collapse to the same `null` return from
`matchCommunity`, the only thing `serveCommunity` branches on.

A chosen row picks up one more thing before it becomes a card: if the
reader's language differs from the row's own `dish.language`, `matchCommunity`
does a second lookup, `getTranslation(chosen.id, readerLang)` — a stored
document, never a model call; translation happens once, at publish (§12).
`toCommunityCard` (`src/lib/community/card.ts`) puts that translation on top
when present and keeps the submitter's own words in `translated_from`, so the
card's "show original" needs no fetch.

A community hit adds exactly one analytics event beyond the `dish_queried`
(`hit: false`) already fired for every turn: `community_served`, carrying
which of the three rules actually chose the row, the match count, and the raw
(unmapped) region string — logged so a wrong or missing `REGION_TO_STATE`
entry shows up in production traffic instead of staying invisible.

When retrieval declines *and* there's no community hit either, *and* there's
no semantic candidate either, the `/api/chat` corpus-miss path injects the
whole swap table (`<component_swaps>`) instead, so the answer becomes a
**component restoration** rather than an apology.

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

## 10. Community submission flow — `POST /api/submissions`

Independent of the conversation thread; the intake side of the community tier
§2/§3 serve from. Two calls, image mode only makes the first.

```
client (Add Your Recipe form, image mode) → POST /api/submissions/extract { photo }
  │
  ├─ rate-limit check ("extract:"+clientKey, MAX_EXTRACTS=3 per window)   → 429
  ├─ content-length precheck against MAX_BODY_BYTES                       → 413
  ├─ validatePhoto(photo)                                                 → 400
  └─ extractRecipe(photo)  (src/lib/community/extract.ts, gemini-3.6-flash)
        null (no key, or the call failed/threw)         → 503
        {ok:false, reason: not_recipe|unreadable|malformed} → 422
        {ok:true, value}                                → 200 { ok:true, extracted }
        Stores nothing. The form prefills from `extracted`; the submitter
        corrects it before anything reaches the next call.

client → POST /api/submissions  { mode, submission, extracted? }
  │
  ├─ rate-limit check ("submit:"+clientKey, MAX_SUBMITS=3 per five minutes)
  │     → 429. Three per window is a person filling in a form, not a loop —
  │     this endpoint spends model tokens per call, so it gets neither the
  │     beacon's allowance nor the chat routes' shared budget.
  ├─ content-length precheck against MAX_BODY_BYTES, before the body is
  │     read — the one legitimately large field is the photo, and its cap
  │     is known; a missing/unparseable length is refused too, since a
  │     chunked body is the one shape that could bypass the cap    → 413
  ├─ validateSubmission(body)                                       → 400
  ├─ insertSubmission({ mode, submission, extracted?, geo })
  │     (src/lib/community/client.ts) → hex id, or null on a store outage
  │     or the daily insert ceiling (SUBMISSION_DAILY_MAX, default 100,
  │     count-then-insert — ponytail: can overshoot by a request or two
  │     under load)                                                 → 503
  ├─ 201 { ok:true } returned immediately — the verdict is never in the
  │     response: GREEN and RED both answer the same 201, so a spammer who
  │     can read the verdict cannot tune against it
  │
  └─ after(): moderate(submission)  (src/lib/community/pipeline.ts)
        one structured gemini-3.1-flash-lite call, given the CONFIRMED text
        (never the raw `extracted` reading) and the photo — a served card
        carries both, so the moderator sees everything a reader will
        → { card: GREEN|RED, reasons[], dish_tag, aliases[], language } | null
        → applyVerdict(id, verdict)  (client.ts)
              writes status + dish{tag,aliases,language}, UNLESS the
              document already carries verdict.overridden_at or
              published_at — either guard leaves the doc exactly as it was
        null (no key, call failed) → doc stays "pending" for a /pantry
              re-run; `after()` rather than `await` means a verdict that
              outlives the platform timeout can no longer turn the 201 into
              a failed response the form would retry as a duplicate
```

---

## 11. Pantry moderation & publish flow — `POST /api/pantry/submissions`

Behind the same gate factory as `/kitchen` (`pantryAccess()`), its own
password (`ADMIN_PASSWORD`) and cookie, because the pantry shows submitters'
contact details and a kitchen session must open nothing here. Checked in the
route handler itself, not only the page, since a route is reachable
regardless of what a page decided.

```
operator → POST /api/pantry/submissions { id, action, card? }
  │
  ├─ pantryAccess() !== "granted"          → 404 (identical body whether no
  │     password is configured or the cookie is wrong)
  ├─ id not 24-hex                          → 400
  │
  ├─ action:"override" { card:GREEN|RED }
  │     overrideVerdict(id, card)  (client.ts) — the operator outranks the
  │       model: stamps verdict.overridden_at, which applyVerdict and any
  │       future re-run both refuse to write over from then on
  │     card===RED also $unsets published_at in the same write, so a
  │       rejection takes the recipe off the site immediately
  │
  ├─ action:"rerun"
  │     refused (409) if verdict.overridden_at or published_at is set — an
  │       override is final, and a published doc must be unpublished first
  │     else: moderate(submission) again, applyVerdict(id, verdict) —
  │       AWAITED, not after(): the operator is watching and wants the answer
  │
  ├─ action:"publish"
  │     publishSubmission(id)  (client.ts) — the human gate: only a TAGGED
  │       GREEN document may ever be served
  │       refuses: not_found / not_green (mark GREEN first) / no_tag (an
  │         untagged document matches nothing, so publishing it would put a
  │         recipe in Published that no reader can ever reach)
  │       ok → $set published_at=now, filtered on status:"green" at write
  │         time, so a status change landing between the read and the
  │         write loses rather than leaving published_at on a red document
  │     → after(): translateMissing(id)  (§12) — the click's 200 flushes
  │         first; one language failing never fails the publish
  │
  └─ action:"unpublish"
        unpublishSubmission(id)  (client.ts) — $unsets published_at, never
          nulls it: applyVerdict's override guard tests for absence, and a
          null left behind would block every future verdict on that
          document forever

GET ?id=&download=1
  │
  ├─ pantryAccess() !== "granted"           → 404 (checked separately, same gate)
  ├─ id not 24-hex, or download≠"1"        → 400
  ├─ getSubmission(id) null                 → 404
  ├─ doc.status !== "green"                 → 409 (only GREEN is a candidate)
  └─ toCorpusCandidate(doc)  (src/lib/community/candidate.ts)
        a GREEN submission reshaped into the corpus record's own shape, for
        a human to incorporate by hand: MODERN_DISH, unverified_seed, no
        original-language text, no photo, contact left behind in the store
        → JSON attachment; RFC 5987 filename carries a non-ASCII slug,
          a stripped-ASCII fallback covers the plain filename param
```

---

## 12. Community translation flow — publish-time, not request-time

```
translateMissing(id)  (src/lib/community/publish-translations.ts)
  │  ONE job, THREE callers: the pantry route's "publish" action (in
  │  after()), scripts/seed-community.ts, and scripts/backfill-translations.ts
  │  — so publishing and translating cannot drift apart the way they once
  │  did, when the seed script called publishSubmission() directly and
  │  twelve seeded recipes went live with zero translations, unnoticed until
  │  a reader asked for one in Hindi
  │
  ├─ getSubmission(id) null (bad id, OR the store is unreachable) → counted
  │     as FAILED, not skipped — a mid-run Atlas outage once reported
  │     "0 written, 0 failed" for every remaining document, indistinguishable
  │     from a clean pass
  │
  ├─ source = doc.dish.language ?? ""
  │     ""   (model could not tell what the submission is written in)
  │            → translate into every SUPPORTED_LANGS entry, English included
  │     else → every SUPPORTED_LANGS entry EXCEPT source
  │
  ├─ translatedLangs(id) — languages already stored; skipped rather than
  │     redone, so republishing (or a retried job) only fills gaps
  │
  └─ for each remaining target language, SEQUENTIALLY (never parallel —
        eight concurrent calls against one submission is how a quota gets
        spent on a single publish):
          translateSubmission(submission, lang)  (translate.ts)
            one gemini-3.6-flash structured call; buildTranslateInput sends
            ONLY recipe_name, story, ingredients, method — never `{...sub}`,
            so contact, display_name, state and city never reach the model
            null on any failure (missing key, timeout, malformed reply) →
              logged, counted failed, skipped
          parseTranslation() — all four fields must come back non-empty,
            else null: a partial translation is worse than none, since an
            empty method is a recipe with no steps
          saveTranslation(id, fields)  (client.ts) — upserts on
            {submission_id, lang}, so a retried job never duplicates a row;
            never writes to `submissions`, so a translation cannot alter the
            submission it translates

── at request time ──────────────────────────────────────────
matchCommunity (§3) calls getTranslation(id, lang) — a stored lookup, never a
model call — only when the reader's detected language differs from the row's
own; toCommunityCard puts it on top and keeps the original in translated_from.
```

---

## 13. Community photo route — `GET /api/community/photo/[id]`

The one route that hands over a submission's photo bytes; everything else
about a submission stays out of the wire until this is asked for.

```
client → GET /api/community/photo/[id]
  │
  ├─ id not 24-hex                        → 404 (not 400 — the id space is
  │     not a reader's business)
  ├─ publishedPhoto(id)  (src/lib/community/client.ts)
  │     one projected query: {status:1, published_at:1, "submission.photo":1}
  │     ok only when status==="green" AND published_at is set AND a photo
  │     exists — a pending, red, or green-but-unpublished document reads as
  │     the IDENTICAL not_found a missing id gives, so the route cannot be
  │     used to enumerate which documents exist in which state
  │     store unreachable → a distinct "unreachable" reason           → 503
  │     anything else not ok                                          → 404
  ├─ mime reasserted against PHOTO_MIMES — not trusted from storage: it
  │     arrived from a client at submission time, and this route hands it
  │     to a browser as Content-Type now                → 404 if not listed
  └─ 200, bytes decoded from base64, Cache-Control: immutable forever (a
        document's photo never changes and the id is the version)
```

---

## How the pipelines connect — summary

- **Corpus validation** (§1) gates everything else; it must pass before dev/deploy is trusted.
- **The chat request** (§2) is the spine. It calls into **retrieval** (§3) synchronously, and retrieval calls into the **pipeline bridge** (§6) only as a last-resort candidate source, never a direct hit.
- **Community serving** (§2, §3) is the tier retrieval and the model both sit around: on every corpus miss, `serveCommunity` is checked before a resolve prompt is built or a model is called, so the answering order is corpus record → published community submission → model. A hit is the cheapest of the three — no prompt, no completion — and it is the *only* insertion point: the corpus-hit branch's own mid-stream record withdrawal (`§NO_ANCESTOR§`) cannot await the Atlas query a community lookup needs, so it never attempts one.
- **Indianisation** (§4) is a mode *of* the chat request, not a separate pipeline — it shares the same route, streaming machinery, and card infrastructure, swapping only the prompt block and marker set.
- **Swap** (§5) and the community intake/moderation/photo flows (§10–§13) don't touch retrieval or turn-mode routing at all — corpus lookup plus optional model prose for swap, Atlas reads and writes for community, both independent of the conversation thread. The one place community *does* join the conversation thread is the single check inside the chat request itself (§2, §3).
- **Community submission** (§10) and **moderation/publish** (§11) are two calls apart on purpose: intake never blocks on a human, and nothing an operator does re-runs unless the document is neither overridden nor published. **Translation** (§12) is a third, later step again — publish-time, not request-time or submit-time — so serving a matched row is always a stored-document lookup, never a model call.
- **Conversation persistence** (§8) and **email tracking** (§9) are both write-through-to-Postgres side channels that degrade to no-ops if `DATABASE_URL` is unset — neither can ever block or break the chat/redirect/pixel response they're attached to. The community store (§10–§13) takes the same fail-soft posture against `ATLAS_*` being unset, and a community lookup failing inside the chat request (§2) costs one turn, never the request, for the identical reason.
- **The pipeline package's own sync/query loop** (§7) is currently the *only* fully-built path to the 199-record corpus, and the app reaches it through exactly one narrow, read-only bridge. Everything else in `pipeline/` (eval, gold-set tooling) is offline tooling that never runs in the request path. The community store (§10–§13) is a second, unrelated database — MongoDB Atlas, not Postgres, not Pinecone — reached only from `src/lib/community/`.
