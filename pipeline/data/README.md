# Recipe Dataset — Ancient Indian Recipe Chatbot

This folder holds the curated, cited recipe data that the chatbot retrieves from.
Everything here is **grounding data**: the bot answers only from these records and
cites their sources. Accuracy of this file = accuracy of the bot.

## Files

- `recipes.json` — the structured recipe records (array of objects).

## Where the data comes from

| Text | Author | Period | Used via |
|------|--------|--------|----------|
| Kshemakutuhalam | Kshemasharma | c. 16th century CE | wisdomlib.org critical study |
| Manasollasa (Abhilashitartha Chintamani) | King Someshvara III | 12th century CE | Wikipedia + secondary summaries |

Every record carries its own `source.url` so any claim can be traced back.

## Record schema

```jsonc
{
  "id": "ksk-kadalikanda-001",        // stable unique id: <text>-<dish>-<n>
  "name": {
    "original": "कदलीकन्द",           // Sanskrit / original script
    "transliteration": "Kadalikanda", // romanized
    "english": "Banana Rhizome in Ghee and Spices"
  },
  "source": {
    "text": "Kshemakutuhalam",
    "author": "Kshemasharma",
    "period": "c. 16th century CE",
    "citation": "Kshemakutuhalam, Kanda-saka section",
    "url": "https://..."              // traceable source
  },
  "region": "North / Central India",
  "category": "vegetable side dish",
  "ingredients": [
    { "original": "hingu", "modern_name": "asafoetida", "quantity": "a pinch" }
  ],
  "steps": [ "Cut the rhizome...", "Boil...", "Cook in ghee..." ],
  "properties": {
    "ayurvedic": "Cold, appetiser, digestive stimulant...",
    "occasion": null,
    "season": null
  },
  "notes": "Free-text context, substitutions, archaic-unit notes.",
  "verification_status": "sourced-unverified"
}
```

### `verification_status` values

- `sourced-unverified` — pulled from a cited source; not yet checked against a primary translation.
- `sourced-needs-primary-check` — sourced, but a specific detail (e.g. exact verse) should be confirmed.
- `verified` — a human has confirmed it against the primary text. **Aim to promote records to this.**

## How to add a recipe

1. Find it in a cited source (prefer primary texts / academic translations).
2. Fill in every field above. Always include `source.url`.
3. Map each archaic ingredient to a `modern_name` so the recipe is cookable today.
4. Set an honest `verification_status`.
5. Keep `id` unique and stable — it becomes the citation key in the chatbot.

## Current contents

**24 recipes** so far:

- **Kshemakutuhalam (15):** banana rhizome, elephant-foot yam, early baingan bharta,
  steamed brinjal, ivy gourd, sweet ash gourd, bitter gourd, banana, cucumber-in-milk,
  roasted gooseberry, lotus buds, drumstick flowers, mango sprouts, hibiscus flowers,
  spiced fish in buttermilk.
- **Manasollasa (9):** spiced fried fish, iddarika (medieval idli), mandaka (flatbread),
  polika (stuffed sweet flatbread), purika (puri), dosaka (early dosa), gharika (early vada),
  vatika (sweet fried balls / early dahi-vada), payasa (rice pudding).

### Texts still to harvest (leads already identified)

- Kshemakutuhalam: Patra-saka (leafy vegetables), remaining fish dishes, meat, rice/anna,
  milk sweets, drinks.
- Manasollasa: full non-vegetarian section, more sweets and drinks.
- Not yet started: Pakadarpana, Bhojanakutuhala, Ayurvedic food sections
  (Charaka / Sushruta Samhita).

## Where it's stored

This file is the **single source of truth**. Pinecone holds a derived copy —
one vector per recipe, with the full record carried in the vector's metadata —
that the chatbot will query. Never edit records in Pinecone; edit here and re-sync.

```
npm run index:setup   # once — creates the Pinecone index
npm run sync:dry      # preview what would change
npm run sync          # embed with Gemini + push to Pinecone
```

`sync` is keyed on `id` and idempotent: unchanged recipes are skipped via a
content hash (so re-running costs no embedding calls), edited ones are
re-upserted, and vectors whose `id` no longer appears in this file are deleted.
Safe to re-run any time.

This is why rule 5 above matters — changing an existing `id` reads to the sync
as "delete that recipe, add an unrelated new one".

## Next steps for the data pipeline

- Grow toward ~30 recipes and start promoting records to `verified`
  (nothing is `verified` yet).
- Then wire up retrieval: embed query → Pinecone top-k → Gemini, with citations.
