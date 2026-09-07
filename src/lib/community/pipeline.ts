// src/lib/community/pipeline.ts
import { GoogleGenAI, Type, type Part } from "@google/genai";

import { isSupported } from "../lang/types";
import { dishTag, isGenericDish, normalizeDish } from "./normalize";
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
  language: string;
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
- aliases: common spellings and romanizations a reader might type, including the name in its original script, e.g. ["vada pav", "wada pav", "vada pao", "वडा पाव"]
- include the SHORT form when people commonly say it on its own, in both scripts: "litti" and "लिट्टी" for litti chokha, "misal" for misal pav, "undhiyu" for undhiyu. A reader who types half the name must still find the dish — the match asks whether their words contain one of these, so a name they never type in full is a name they never find.
- include BOTH the singular and the plural when English uses them, in every script you list: "brownie" and "brownies", "samosa" and "samosas". A reader typing one must not miss a recipe stored under the other — the match asks whether their words contain a stored form, so "brownie" does not reach a row whose only alias is "brownies".
- but never shorten to a word that names a category or a component rather than this dish: not "pav", "dal", "curry", "rice", "chokha" on its own, and not "kadhi" for sol kadhi — kadhi is a different dish. If the short form would name something else, or would match questions that have nothing to do with this recipe, leave it out. A missing alias costs one reader's search; a wrong one answers everybody's.
- language: the ISO 639-1 code of the language most of the submission is written in — one of en, hi, bn, mr, te, ta, gu, kn — or "" if it is none of those or you are unsure
- judge the language, not the script. An Indian language written in Latin letters is still that language: "aloo ko boil karke mash kar lo" is hi, not en, and romanized Marathi is mr. English carrying a few borrowed dish or ingredient names is still en.`;

export async function moderate(sub: SubmissionInput): Promise<Verdict | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const body = [
    `Submitted by: ${sub.display_name}`,
    `Recipe name: ${sub.recipe_name}`,
    `State: ${sub.state}${sub.city ? `, ${sub.city}` : ""}`,
    `Belongs to: ${sub.belongs_to}${sub.belongs_to_other ? ` (${sub.belongs_to_other})` : ""}`,
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
            language: { type: Type.STRING },
          },
          required: ["card", "reasons", "dish_tag", "aliases", "language"],
        },
      },
    });

    const parsed = JSON.parse(res.text ?? "") as Omit<Verdict, "model">;
    if (parsed.card !== "GREEN" && parsed.card !== "RED") return null;

    // The tag is what Phase 4 matches on. An empty one from the model falls
    // back to the submitter's own name for the dish; if even that normalises
    // to nothing, the verdict is malformed and the doc stays pending.
    //
    // A tag that is only category words is treated as no tag: "chicken curry"
    // would match every query with those words in it. The doc stays pending
    // and the log says why, so the operator can see it rather than publish it.
    const tagged = dishTag(String(parsed.dish_tag ?? "")) || dishTag(sub.recipe_name);
    const dish_tag = isGenericDish(normalizeDish(tagged)) ? "" : tagged;
    if (!dish_tag) {
      console.error(`[community] no usable dish tag (generic or empty: ${JSON.stringify(tagged)})`);
      return null;
    }

    const language = isSupported(String(parsed.language ?? "")) ? String(parsed.language) : "";

    return {
      card: parsed.card,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 8) : [],
      dish_tag,
      aliases: Array.isArray(parsed.aliases)
        ? [...new Set(parsed.aliases.map((a) => normalizeDish(String(a))))]
            .filter((a) => a && !isGenericDish(a))
            .slice(0, 12)
        : [],
      language,
      model,
    };
  } catch (error) {
    console.error("[community] verdict call failed:", error);
    return null;
  }
}
