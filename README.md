# The Great Indian Food Restoration

A discovery machine, not a recipe app. Name a dish you eat every week and it
shows you what that dish was before colonial-era crop policy, export
agriculture and industrial milling rewrote it — then hands you a version you
can cook tonight.

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY
npm run check          # validate the corpus, then prove retrieval
npm run dev
```

`npm run check` runs before anything else on purpose. The corpus is the
product; the chatbot is the interface.

---

## How it is put together

Built in the order the brief specifies: corpus → retrieval → model → UI.

```
corpus/            JSON records, one per culinary item (the Part 3 contract)
  ancient/         the originals
  modern/          their modern counterparts, and modern-dish records
  swaps/           ingredient swap records
src/lib/corpus/    types, validator, file-backed repository
src/lib/retrieval/ normalisation, BM25, the threshold and ambiguity gates
src/lib/model/     system prompt, corpus block, streaming beat parser
src/lib/chat/      conversation state as an external store, localStorage-backed
src/app/           chat surface, /dish/[slug], API routes, 1080×1350 share card
tests/             132 hand-checked retrieval queries
```

### Two kinds of turn

It is a thread, not a card feed. Every turn is one of two kinds, and the
**server** decides which — the same place the retrieval gates live, rather than
a classifier guessing:

| Turn | When | Renders as |
|---|---|---|
| **Restoration** | the message names a dish retrieval can find | the four-beat card |
| **Conversation** | anything else, with the current dish carried forward | plain prose |

So "kheer" opens a card, "why did the jaggery go?" is answered against the
kheer records already on screen, and "what about dosa" swaps the card to dosa.
Prior turns are replayed to the model, capped at the last 20.

Threads persist in localStorage and are listed in the history drawer. There is
no account, and the product does not need one.

### The shell

Built on the supplied chat component — full-bleed backdrop, hook centred over
it, glass composer, quick-action pills. That design is an empty state, so it is
used as one: once a thread starts the backdrop and composer carry over and the
middle becomes the conversation. `Button` and `Textarea` are shadcn-shaped
(same `variant`/`size`/`asChild` API) but resolve to this product's tokens
rather than shadcn's theme, so there is only one colour system in the sheet.

The background is a solid fill from `--paper`. There is no image — the earlier
backdrop was a 5.6 MB PNG on a third-party bucket, which for a QR code opened
on phone data was the heaviest thing on the page.

### Light and dark

Every piece of chrome resolves through the tokens, so a theme is one attribute
flip on `<html>` rather than two sets of hardcoded classes. The toggle is in
the header.

- `:root` holds light, `:root[data-theme="dark"]` holds dark.
- The `prefers-color-scheme` block is scoped to `:root:not([data-theme])`, so
  it is a no-JS fallback only and an explicit choice always beats the OS.
- `THEME_INIT_SCRIPT` runs inline in `<head>` **before first paint**, so there
  is no flash of the wrong theme on load. `<html>` carries
  `suppressHydrationWarning` because that script writes the attribute before
  React hydrates, which is the whole point of it.
- The choice persists in localStorage; first visit follows the OS.

The background colour lives on `html`, not `body` — `html`'s background
propagates to the canvas, so it also covers overscroll.

### The line that keeps red line #1 closed

The model writes prose. It does not write citations — because it does not write
the part of the card citations live in.

Every citational element (ingredient table, ancient method, source strip,
provenance badge, contested points, Then/Now diff, nutrition delta, share
image) is rendered directly from the retrieved record. The model receives four
markers to fill with prose and an explicit instruction that a chapter, verse,
edition or page typed into that prose would be an unsourced claim by
definition. A record whose citation has not been verified has its locus
**withheld from the model entirely** — it cannot leak a page number it was
never given.

### Verification state

The Part 3 schema is implemented as specified, with one addition: every record
carries a `verification` block declaring whether a human has checked its locus
against the printed edition.

The validator enforces the consequences:

- `ATTESTED` requires `verification.status: "editor_verified"`. An unchecked
  citation cannot present itself as attested.
- An unverified record must have `original_text`, `transliteration` and
  `translation` set to `null`. Source-language text may only be entered by an
  editor reading the edition.
- A `MODERN_DISH` may not carry a source locus at all.

Nine records come from the editorial extraction *Recipes: Before British*
(`scripts/import-pdf-corpus.mjs`) and carry located, rendered passages — six
of them `ATTESTED`. Bedhai has the full Devanagari from *Pāka Śāstra* p. 169;
idli, dosa, dal, payasa and the kṣīra sweet have translations from the
Mānasollāsa dated 1129 CE.

**Five hand-authored seeds remain** — khichdi, roti, vada, poha, laddu. They
claim a text and a period but no verse or page, render a visible "unchecked"
mark on the badge, and the drawer says plainly that nobody has opened the
edition. Promoting one means filling in the locus and the passage and flipping
`verification.status`.

The extraction corrected three things the seeds had wrong, which is the
argument for doing the corpus first:

| | Seed said | Extraction shows |
|---|---|---|
| **Upma** | a modern dish (rava needs a roller mill) | predates the Raj as *arisi upma*; rava is the 1942 substitution |
| **Kheer** | jaggery was the ancient sweetener | *Pāyasa* was barely sweet — sugar went on at the table, not in the pot |
| **Dosa** | a rice-and-dal batter, `INFERRED` | split **chickpea**, no rice at all, `ATTESTED` at 1129 CE |

One thing deliberately not carried across: the *Pāka Śāstra* passage makes
Ayurvedic claims about what the dish cures. Those are recorded as part of what
the text says and never as a claim of this product's own.

### Retrieval

Keyword-first, exactly as the brief requires. BM25 over dish names and aliases
only — ingredients and method belong to the vector index, and mixing them in
makes "coconut" retrieve six records. Vectors are the fallback (`searchVectors`
is in the repository interface and currently returns nothing, which is the
correct behaviour for a fallback that is not wired up).

Three gates decide when to decline, because a wrong ancestor is worse than no
ancestor:

| Gate | What it stops |
|---|---|
| Score threshold (`MIN_KEYWORD_SCORE`) | coincidental matches |
| Unknown-token veto | `misal pav` resolving to pav bhaji; `paneer tikka` to palak paneer |
| Ambiguity gate | `vada pav` — half-explained by two records, fully by neither |

Anything that declines is logged as `no_original_found` with a `[corpus-gap]`
prefix. That log is the roadmap for corpus expansion.

### When the dish isn't in the corpus

Declining is not the end of the answer. On an empty retrieval the route injects
the whole swap table as `<component_swaps>`, and the card becomes a component
restoration rather than an apology — ask for palak paneer and you are told its
cream can be hung curd or a ground kabuli chana paste, with the ratio attached.

The ratios come from the swap records, never from generation. A fabricated
quantity is the same class of failure as a fabricated verse, just quieter, so
the prompt requires quoting the block verbatim and saying "no ratio for that"
rather than estimating. Each entry also names the axis it wins on — protein,
fibre, glycaemic load — because "healthier" on its own is not a claim this
project makes, and some entries say outright that they win on flavour and
nothing else.

`tests/retrieval-queries.json` holds 132 hand-checked queries covering Hinglish
spellings, Devanagari and Tamil, and the traps above. The harness fails the
build on any **wrong** answer and on more misses than `ALLOWED_MISSES` (zero).

### Model layer

Provider-agnostic behind `src/lib/model/provider.ts`. Everything above it — the
four-beat contract, the corpus block, turn-mode routing, the beat parser — is
just prose generation, so swapping vendors is one implementation rather than a
rewrite of the route.

Selection is by whichever key is present, with `MODEL_PROVIDER` as the override
when both are:

| Provider | Default model | Notes |
|---|---|---|
| **Gemini** | `gemini-2.5-flash` | The Gemini 3 models list as available and then 429 without quota. `GEMINI_THINKING_BUDGET=0` by default — thinking is on for 2.5 and nothing streams until it finishes, which reads as a dead screen. |

> ⚠️ **The current key is on the Gemini free tier: 20 requests per day, per
> model.** An afternoon of testing spends it. Quota exhaustion is reported as
> its own error rather than "try again", because retrying cannot fix it. The
> daily budget is per model, so `GEMINI_MODEL=gemini-2.5-flash-lite` buys a
> fresh 20; a billed key removes the ceiling.
| **Anthropic** | `claude-opus-5` | Frozen system prompt in a cached block, volatile content after the breakpoint. `RESTORATION_EFFORT=low` for the same latency reason. |

Prompt caching is Anthropic-specific here; Gemini 2.5 does implicit caching on
its own and needs no breakpoint.

#### The provenance tripwire

Gemini's first output on this prompt ended `§THEN§` with *"This is an ATTESTED
dish"* — for a record that is `RECONSTRUCTED` and not yet verified, with a
badge saying exactly that a centimetre above. That is red line #1 arriving by
accident.

Two changes came out of it. The prompt now forbids naming the provenance class
in prose at all, on the same grounds as citations: the badge renders the real
class from the record, so a class the model types is duplication at best and a
contradiction on the same screen at worst. And `src/lib/model/guards.ts` audits
every completion for provenance words, certainty claims against unverified
records, and chapter/verse shapes, logging `[provenance-leak]` when it finds
one.

The tripwire is not the protection — the reader is protected because the badge
and source strip come from the corpus regardless of what the model says. It
exists so a prompt regression shows up in the logs rather than in a screenshot
on X.

Responses are streamed as NDJSON: one `meta` event carrying the turn mode and
the records, then either `delta` events tagged by beat (restoration) or `text`
events (conversation), then `done`. The card renders its record half the moment
`meta` lands, before the model has written a word. A missing API key costs the
prose, not the card.

Both output formats live in one system prompt rather than two, because the
prompt is the cached prefix — one frozen block every request shares is worth
more than a marginally shorter one that splits the cache. Which mode applies is
stated in the user turn, after the breakpoint, where it costs nothing.

---

## Working on the corpus

Add a record under `corpus/ancient/` or `corpus/modern/`, then:

```bash
npm run check
```

Rules the validator will hold you to, beyond the schema: ancient records need a
`modern_counterpart_id` (the diff is the product), aliases may not collide
across records, and slugs are public URLs so they must be kebab-case. Write a
`share_verdict` on anything that ships — it is the share image's headline and
the card's fallback verdict, and it is deliberately editorial rather than
generated.

When you add a dish, add its query variants to `tests/retrieval-queries.json`
too — including at least one near-miss that must **not** match it.

---

## Known gaps

- **The share image renders in a fallback sans-serif.** Satori needs an
  embedded font file and none is shipped, so the card loses the serif display
  face the rest of the product uses. Drop a `.ttf`/`.otf` in and pass it via
  the `fonts` option in `src/app/api/share/[slug]/route.tsx`.
- **Vector retrieval is a stub.** The interface is in place and threshold
  discipline is written to cover it; the pgvector implementation is not.
- **The language toggle is not built.** Hinglish input is understood and the
  model replies in the language of the question, but there is no UI toggle
  stub for Hindi, Marathi, Tamil, Telugu or Kannada yet.
- **Analytics goes to the console.** `track()` is a one-function shim over a
  real sink.
- **Eight ancient records await editorial verification** — see above. This is
  a state, not a bug, and the product says so out loud on every card.
