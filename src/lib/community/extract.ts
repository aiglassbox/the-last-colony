// src/lib/community/extract.ts
import { GoogleGenAI, Type } from "@google/genai";

import { validateExtracted, type Extracted, type Photo } from "./schema";

/**
 * The reader for "From a photo": one structured call on the full-quality
 * tier (handwriting and regional scripts are the point), recipe fields out.
 *
 * This module never writes. What it returns goes to the browser, the
 * submitter corrects it, and only the confirmed words are stored — with the
 * reading kept beside them as `extracted`. A transcription is not the
 * submitter's words until they say so.
 *
 * Same posture as `moderate`: direct SDK call, JSON schema, null on failure.
 */

export const EXTRACT_MODEL = () => process.env.SUBMISSION_EXTRACT_MODEL?.trim() || "gemini-3.6-flash";

const PROMPT = `You transcribe recipes from photos for a community archive of Indian family recipes. The photo is a handwritten or printed recipe card, a page from a notebook, or a photo of the dish itself. Answer with JSON only.

Rules:
- Transcribe what is written, in the script and language it is written in. Do not translate, do not modernise spellings, do not add ingredients or steps that are not on the card. If a word is unclear, keep your best reading rather than dropping it.
- If the photo shows only the dish (no text), set is_recipe true only if you can name the dish: put that name in recipe_name and leave ingredients and method empty — the submitter will write them.
- If the photo shows neither a recipe card nor a dish (a screenshot, a document, an unrelated person, a blank page, nonsense text), set is_recipe false and say why in note.
- readable is false when there is text but it is too blurred, dark or cut off to transcribe faithfully; say so in note. A photo with no text at all (the dish itself) is readable.
- Never invent a story. story is only text on the card about when or why the dish is made — not the recipe itself. Usually it is empty.
- language: the ISO 639-1 code of the language most of the text is in — one of en, hi, bn, mr, te, ta, gu, kn — or "" if unsure.
- Keep ingredients one per line and method as numbered or line-separated steps, exactly as far as the card gives them.`;

export type ExtractResult =
  | { ok: true; value: Extracted }
  | { ok: false; reason: "not_recipe" | "unreadable" | "malformed" };

/**
 * Model JSON → what the form may prefill. Pure and exported for the check
 * script. The gates are literal: a string "true" is not a recipe.
 */
export function parseExtraction(raw: unknown): ExtractResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "malformed" };
  const r = raw as Record<string, unknown>;
  if (r.is_recipe !== true) return { ok: false, reason: "not_recipe" };
  if (r.readable !== true) return { ok: false, reason: "unreadable" };
  const checked = validateExtracted(r);
  if (!checked.ok) return { ok: false, reason: "malformed" };
  const { recipe_name, ingredients, method } = checked.value;
  if (!recipe_name && !ingredients && !method) return { ok: false, reason: "not_recipe" };
  return { ok: true, value: checked.value };
}

export async function extractRecipe(photo: Photo): Promise<ExtractResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const res = await client.models.generateContent({
      model: EXTRACT_MODEL(),
      contents: [
        { inlineData: { mimeType: photo.mime, data: photo.data } },
        { text: "Transcribe this recipe." },
      ],
      config: {
        abortSignal: AbortSignal.timeout(40_000),
        systemInstruction: PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            is_recipe: { type: Type.BOOLEAN },
            readable: { type: Type.BOOLEAN },
            recipe_name: { type: Type.STRING },
            story: { type: Type.STRING },
            ingredients: { type: Type.STRING },
            method: { type: Type.STRING },
            language: { type: Type.STRING },
            note: { type: Type.STRING },
          },
          required: ["is_recipe", "readable", "recipe_name", "story", "ingredients", "method", "language", "note"],
        },
      },
    });
    return parseExtraction(JSON.parse(res.text ?? ""));
  } catch (error) {
    console.error("[community] extraction call failed:", error);
    return null;
  }
}
