import { activeProvider } from "@/lib/model/provider";
import { enFallback, isSupported, type Normalized } from "./types";

/**
 * Detect the language of a dish query and translate it to English.
 *
 * Runs before retrieval, because the keyword engine is English: a Tamil-script
 * or Hinglish query has to become English to be scored. One cheap model call —
 * dish names are short — and it degrades to the English fallback on anything it
 * cannot do confidently, so retrieval always has a string to run.
 */

/** Below this the detection is not trusted and the turn falls back to English. */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Small cap: the reply is a single JSON object, never prose. */
const NORMALIZE_MAX_TOKENS = 200;

const NORMALIZE_SYSTEM = `You are a language detector and translator for an Indian-food search box.
The user types the name of a dish, or a short question about one, in one of:
English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, or Urdu —
in native script, romanized (Latin letters), or mixed Hinglish.

Reply with ONE JSON object and nothing else:
{"lang":"<iso639-1>","script":"native|roman","register":"native|hinglish|roman","confidence":0..1,"english":"<the query in English>"}

Rules:
- lang is the ISO 639-1 code: en, hi, bn, mr, te, ta, gu, kn, ur.
- script is "native" if the user wrote in a non-Latin script, else "roman".
- register is "hinglish" for Latin-script Indian-language mixed with English,
  "roman" for a purely romanized single language, "native" for a native script.
- english is the dish name or question translated to natural English. Keep
  proper nouns and dish names as themselves (idli stays idli).
- confidence is your certainty about lang, 0 to 1.
- Output the JSON only. No markdown, no code fence, no commentary.`;

/**
 * Parse the model's JSON into a `Normalized`, forcing the English fallback on
 * anything malformed, unsupported, or under-confident. Pure and synchronous so
 * it can be tested without the network — the model call is the only impure part.
 */
export function parseNormalizeResponse(
  raw: string,
  original: string,
  threshold = CONFIDENCE_THRESHOLD,
): Normalized {
  let obj: Record<string, unknown>;
  try {
    // The model is told "JSON only" but a stray fence is cheap to survive.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return enFallback(original);
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return enFallback(original);
  }

  const lang = typeof obj.lang === "string" ? obj.lang : "";
  const confidence = typeof obj.confidence === "number" ? obj.confidence : 0;
  const english =
    typeof obj.english === "string" && obj.english.trim() ? obj.english.trim() : original;

  // Unsupported language (Urdu included) or weak detection: English fallback,
  // but keep the model's English translation if it produced one — a usable
  // English query still beats retrieving on Urdu script.
  if (!isSupported(lang) || confidence < threshold) {
    return { ...enFallback(original), english };
  }

  const script = obj.script === "native" ? "native" : "roman";
  const register =
    obj.register === "native" ? "native" : obj.register === "hinglish" ? "hinglish" : "roman";

  return { lang, script, register, confidence, english, fell_back: false };
}

export async function normalize(query: string): Promise<Normalized> {
  const trimmed = query.trim();
  if (!trimmed) return enFallback(query);

  // A single ASCII word with no Indian-language markers is almost certainly an
  // English dish name ("dosa", "khichdi"); skip the call. Anything longer may be
  // Hinglish ("idli kaise banti hai"), which must be detected so the reply can
  // mirror it, so it goes through the model.
  if (/^[a-z]+$/i.test(trimmed)) {
    return { ...enFallback(trimmed), fell_back: false, register: "roman" };
  }

  const provider = activeProvider();
  if (!provider) return enFallback(trimmed);

  try {
    const raw = await provider.completeText({
      system: NORMALIZE_SYSTEM,
      maxTokens: NORMALIZE_MAX_TOKENS,
      messages: [{ role: "user", content: trimmed }],
    });
    return parseNormalizeResponse(raw, trimmed);
  } catch {
    // Quota, network, refusal: retrieval must still run, so fall back rather
    // than throw into the request path.
    return enFallback(trimmed);
  }
}
