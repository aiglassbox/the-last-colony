// src/lib/community/pipeline.ts
import { GoogleGenAI, Type, type Part } from "@google/genai";

import { normalizeDish } from "./normalize";
import type { SubmissionInput } from "./schema";

/**
 * The intake moderator: one structured call, GREEN or RED, plus the canonical
 * dish tag and alias spellings Phase 4 will match against.
 *
 * Deliberately NOT routed through `src/lib/model/provider.ts` — that module
 * is shaped around the chat system prompt and its cache, and a moderation
 * verdict caching a 7,600-token brief would pay for nothing. A direct SDK
 * call with a JSON response schema is the whole job.
 *
 * The moderator sees everything a reader will: the name on the entry and the
 * photo, because a served community card carries both. Nothing it does not
 * see can be gated by it.
 *
 * Null on any failure. The caller keeps the doc `pending`; a lost verdict
 * costs a re-run from /pantry (Phase 3), never a submission.
 */

export interface Verdict {
  card: "GREEN" | "RED";
  reasons: string[];
  dish_tag: string;
  aliases: string[];
  model: string;
}

const VERDICT_MODEL = () => process.env.SUBMISSION_VERDICT_MODEL?.trim() || "gemini-3.1-flash-lite";

const PROMPT = `You are the intake reviewer for a community archive of Indian family recipes. Real names are attached to every entry, so junk is not harmless. Review the submission and answer with JSON only.

Issue "RED" if ANY of these hold, and list which in reasons:
- spam, advertising, or abuse — in the text, in the submitter's name, or in the photo
- not actually a recipe (no recognisable dish, ingredients or method)
- incoherent or filler text (jargon, lorem ipsum, keyboard mash)
- health claims (curative, therapeutic, "boosts immunity", weight-loss promises)
- communal framing: crediting or blaming a religious or ethnic community for how people eat, or attributing dietary change to one
- personal data planted in public fields (phone numbers, addresses, emails in the story/method) or visible in the photo
- a photo that is not a dish, a recipe card, or a kitchen or cooking scene (a screenshot, an unrelated document, a portrait with no food or kitchen in frame, an unrelated object)

Otherwise issue "GREEN". A submitter's own name, state, city, language, and the family member a recipe belongs to are expected context — every entry carries them — and are never grounds for RED. A blurred, dark, or badly framed photo of a dish or card is not grounds for RED. Family memories are not claims to fact-check; do not judge authenticity, only the list above.

Also name the dish:
- dish_tag: the canonical dish name in lowercase Latin kebab-case, e.g. "vada-pav"
- aliases: common spellings and romanizations a reader might type, including the name in its original script, e.g. ["vada pav", "wada pav", "vada pao", "वडा पाव"]`;

export async function moderate(sub: SubmissionInput): Promise<Verdict | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const body = [
    `Submitted by: ${sub.display_name}`,
    `Recipe name: ${sub.recipe_name}`,
    `State: ${sub.state}${sub.city ? `, ${sub.city}` : ""}`,
    `Belongs to: ${sub.belongs_to}${sub.belongs_to_other ? ` (${sub.belongs_to_other})` : ""}`,
    `Language: ${sub.language}`,
    `Story: ${sub.story}`,
    `Ingredients: ${sub.ingredients}`,
    `Method: ${sub.method}`,
    sub.photo ? "A photo is attached." : "No photo attached.",
  ].join("\n");

  const parts: Part[] = [{ text: body }];
  if (sub.photo) parts.push({ inlineData: { mimeType: sub.photo.mime, data: sub.photo.data } });

  try {
    const client = new GoogleGenAI({ apiKey: key });
    const model = VERDICT_MODEL();
    const res = await client.models.generateContent({
      model,
      contents: parts,
      config: {
        // A photo roughly doubles the round trip on the lite tier.
        abortSignal: AbortSignal.timeout(30_000),
        systemInstruction: PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            card: { type: Type.STRING, enum: ["GREEN", "RED"] },
            reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
            dish_tag: { type: Type.STRING },
            aliases: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["card", "reasons", "dish_tag", "aliases"],
        },
      },
    });

    const parsed = JSON.parse(res.text ?? "") as Omit<Verdict, "model">;
    if (parsed.card !== "GREEN" && parsed.card !== "RED") return null;

    const kebab = (s: unknown) => normalizeDish(String(s ?? "")).replace(/\s+/g, "-");
    // The tag is what Phase 4 matches on. An empty one from the model falls
    // back to the submitter's own name for the dish; if even that normalises
    // to nothing, the verdict is malformed and the doc stays pending.
    const dish_tag = kebab(parsed.dish_tag) || kebab(sub.recipe_name);
    if (!dish_tag) return null;

    return {
      card: parsed.card,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 8) : [],
      dish_tag,
      aliases: Array.isArray(parsed.aliases)
        ? [...new Set(parsed.aliases.map((a) => normalizeDish(String(a))))].filter(Boolean).slice(0, 12)
        : [],
      model,
    };
  } catch (error) {
    console.error("[community] verdict call failed:", error);
    return null;
  }
}
