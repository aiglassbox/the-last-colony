// src/lib/community/translate.ts
import { GoogleGenAI, Type } from "@google/genai";

import { LANG_NAMES, type SupportedLang } from "../lang/types";
import type { TranslatedFields } from "./card";
import type { SubmissionInput } from "./schema";

/**
 * Translation at publish: one structured Gemini call per language, run once
 * when an operator publishes a submission — `client.ts`'s publish job calls
 * this in a loop, one call per language, and stores what it returns. Serving
 * is then a lookup, never a call: no Mongo happens in this file, and no model
 * call happens at request time.
 *
 * Same posture as `moderate` (./pipeline.ts) and `extractRecipe` (./extract.ts):
 * a direct `@google/genai` call with a JSON response schema, null on any
 * failure, logged — never thrown, because a failed translation costs one
 * language, never the publish.
 */

export const TRANSLATE_MODEL = () => process.env.SUBMISSION_TRANSLATE_MODEL?.trim() || "gemini-3.6-flash";

/**
 * The four fields the model sees, built one at a time — never `{ ...sub }`,
 * never `JSON.stringify(sub)`. `sub` also carries `contact` (a member of the
 * public's phone or email), plus `display_name`, `state` and `city`; none of
 * those four has any translation work to do and none may reach a third-party
 * API. Exported so `scripts/check-community-match.ts` can assert, offline,
 * that the built object carries none of them.
 */
export function buildTranslateInput(sub: SubmissionInput): {
  recipe_name: string;
  story: string;
  ingredients: string;
  method: string;
} {
  return {
    recipe_name: sub.recipe_name,
    story: sub.story,
    ingredients: sub.ingredients,
    method: sub.method,
  };
}

function systemPrompt(lang: SupportedLang): string {
  const name = LANG_NAMES[lang];
  return `You are translating a community family recipe submission into ${name} for a public recipe archive.

You will receive ONE JSON object with four fields: recipe_name, story, ingredients, method. Return ONE JSON object with the EXACT same four keys, every string value translated into ${name}. Nothing else — no markdown, no code fence, no commentary.

Rules:
- Translate faithfully. Do not modernise or improve the recipe, and do not add advice or commentary of any kind.
- ingredients and method are each a block of text, one ingredient or step per line. Preserve that line structure EXACTLY: the same number of lines, in the same order. Do not add, remove, merge, split or reorder any ingredient or step.
- Keep numerals as digits ("2", "1/4"); translate the units and words around them ("2 cups, soaked" -> the ${name} for "2 cups, soaked").
- Keep dish and ingredient names as loanwords, in the ${name} script, where translating them would obscure what they are.
- No health claims, no added advice, no provenance-class words. Translate only what is given.
- Do not invent content for an empty field; do not leave a non-empty field blank.`;
}

/**
 * Model JSON -> `TranslatedFields`, or null. Pure and exported so
 * `scripts/check-community-match.ts` can pin it with no network: a
 * well-formed reply produces a full record; a reply missing a field, or one
 * whose value comes back empty, produces null rather than a half-translated
 * record — a partial translation is worse than none, because the card would
 * show a recipe with a missing half (an empty `method` is a recipe with no
 * steps).
 */
export function parseTranslation(raw: unknown, lang: SupportedLang, model: string): TranslatedFields | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const recipe_name = typeof r.recipe_name === "string" ? r.recipe_name.trim() : "";
  const story = typeof r.story === "string" ? r.story.trim() : "";
  const ingredients = typeof r.ingredients === "string" ? r.ingredients.trim() : "";
  const method = typeof r.method === "string" ? r.method.trim() : "";
  if (!recipe_name || !story || !ingredients || !method) return null;
  return { lang, recipe_name, story, ingredients, method, model };
}

/**
 * One recipe, one target language, one call. Null on any failure — a missing
 * key, a timeout, a malformed or partial reply — always logged.
 */
export async function translateSubmission(
  sub: SubmissionInput,
  lang: SupportedLang,
): Promise<TranslatedFields | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = TRANSLATE_MODEL();
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const res = await client.models.generateContent({
      model,
      contents: [{ text: JSON.stringify(buildTranslateInput(sub)) }],
      config: {
        abortSignal: AbortSignal.timeout(30_000),
        systemInstruction: systemPrompt(lang),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recipe_name: { type: Type.STRING },
            story: { type: Type.STRING },
            ingredients: { type: Type.STRING },
            method: { type: Type.STRING },
          },
          required: ["recipe_name", "story", "ingredients", "method"],
        },
      },
    });
    return parseTranslation(JSON.parse(res.text ?? ""), lang, model);
  } catch (error) {
    console.error(`[community] translation call failed (${lang}):`, error);
    return null;
  }
}
