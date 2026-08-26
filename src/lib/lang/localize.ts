import type { CorpusRecord } from "@/lib/corpus/types";
import { activeProvider } from "@/lib/model/provider";

import { EN_LABELS, validateLocalizedCard, type LocalizedCard, type NutritionAxis } from "./localized-card";
import { LANG_NAMES, type SupportedLang } from "./types";

/**
 * Translate one restoration card into one language.
 *
 * This is the model half of the localized-card feature, and it runs at BUILD
 * time (the `localize:corpus` script), never per request — a record's
 * translation is deterministic, so it is computed once, reviewed, and committed
 * as data. See `.docs/specs/2026-08-25-localized-card-spec.md`.
 *
 * The model is given the SAME record data it already gets at request time (the
 * `<corpus_records>` block), so this crosses no new boundary. Rule 2 is honored
 * by construction: for an unverified record the locus and edition are never put
 * into the payload, the same way `renderRecord` withholds them from the model.
 */

const MAX_OUTPUT = 2200;

/** The display quantity the card shows: modern first, else the source's. */
function displayQuantity(i: CorpusRecord["ingredients"][number]): string | null {
  return i.quantity_modern ?? i.quantity_source;
}

/**
 * The English values to translate, in the exact shape `validateLocalizedCard`
 * reads back. Keys stay English (they are the wire contract); only values are
 * translated. This is also what the content hash is taken over, so an edit to
 * any translatable field re-triggers the record's translation and nothing else.
 */
export function buildLocalizeInput(record: CorpusRecord) {
  const verified = record.verification.status === "editor_verified";
  const axes: Partial<Record<NutritionAxis, string>> = {};
  for (const key of Object.keys(record.substitution_story?.nutrition_delta ?? {})) {
    axes[key as NutritionAxis] = EN_LABELS.axes[key as NutritionAxis];
  }

  return {
    labels: EN_LABELS,
    record: {
      verdict: record.share_verdict,
      ingredients: record.ingredients.map((i) => ({
        name: i.name,
        quantity: displayQuantity(i),
        function: i.function,
      })),
      method: record.method_reconstructed,
      source: {
        text: record.source.text,
        author: record.source.author,
        century: record.source.century,
        // Rule 2: locus/edition only exist in the payload for a verified record.
        edition: verified ? record.source.edition : null,
        locus: verified ? record.source.locus : null,
      },
      contested_points: record.contested_points,
      restore_today: record.restore_today
        ? { ingredients: record.restore_today.ingredients, steps: record.restore_today.steps }
        : null,
      axes,
    },
  };
}

// ponytail: the numeral rule below is best-effort, not enforced. The model
// mostly keeps Western digits but at times renders native numerals (২, ১/৪), so
// numeral style is inconsistent across dishes and runs. Left as-is by decision;
// if consistency is ever wanted, do it deterministically in the card (a digit
// map over the quantity column, scoped past the century and "100%"), not here.
function systemPrompt(lang: SupportedLang): string {
  const name = LANG_NAMES[lang];
  return `You are a culinary translator localizing a recipe card into ${name}.

You will receive ONE JSON object of English values. Return ONE JSON object with
the EXACT same structure and the same keys, every string VALUE translated into
${name}. Nothing else — no markdown, no code fence, no commentary.

Rules:
- Do a FULL translation, not a transliteration: "salt" becomes the ${name} word
  for salt, "scattered over after cooking" becomes the ${name} sentence for it.
- Keep every array the SAME LENGTH and the same order. Do not add, drop, merge
  or reorder items. Keep JSON keys in English exactly as given.
- Keep numerals as digits ("2", "1/4"); translate the units and words around
  them ("2 cups, soaked" -> the ${name} for "2 cups, soaked").
- Transliterate proper nouns of texts and people into the ${name} script where
  natural ("Mānasollāsa", author names, century). Keep them as names, do not
  gloss them.
- A null value stays null. Do not invent content for an empty field.
- No health claims, no added advice, no provenance-class words. Translate only
  what is given.`;
}

/**
 * Translate a record into `lang`, or null if the model fails or returns a
 * structurally invalid card (which the caller renders in English instead).
 */
export async function translateRecord(
  record: CorpusRecord,
  lang: SupportedLang,
): Promise<LocalizedCard | null> {
  const provider = activeProvider();
  if (!provider) return null;

  try {
    const raw = await provider.completeText({
      system: systemPrompt(lang),
      maxTokens: MAX_OUTPUT,
      temperature: 0,
      messages: [{ role: "user", content: JSON.stringify(buildLocalizeInput(record)) }],
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return validateLocalizedCard(record, lang, parsed);
  } catch {
    return null;
  }
}
