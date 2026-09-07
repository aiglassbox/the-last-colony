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
- lang is the language of the SENTENCE, never of the dish. Dish and ingredient
  names are loanwords in every language and do not set lang: "how to make
  taal?" and "taal recipe" are English (lang "en") even though taal is a
  Bengali dish; "taal kivabe banabo" is Bengali (lang "bn") because the words
  around the dish are Bengali. Only the words around the dish name decide.
- Decide lang in this order, and stop at the first step that answers:
  STEP 1. Strip the dish name out of the message and look at what is LEFT. If
  any words remain, they alone set lang, whatever script the dish name itself
  was in. "kaise banate hain" is Hindi, so "misal pav kaise banate hain" is hi;
  "kashi banvaychi" is Marathi, so "puran poli kashi banvaychi" is mr; "kivabe
  banabo" is Bengali, so "taal kivabe banabo" is bn; "how to make" is English,
  so "how to make ডোসা" is en even though the dish is in Bengali script.
  STEP 2. Nothing is left — the message was only the dish name. Now the script
  decides, because choosing a script is itself writing in a language: "इडली" is
  hi, "இட்லி" is ta, "থালীপীঠ" is bn, "थालीपीठ" is hi. Never answer "en" for a
  bare name in a non-Latin script.
  STEP 3. Nothing is left and the name is in Latin letters. Then lang is "en",
  however many words the name runs to: "misal pav", "puran poli", "sol kadhi",
  "litti chokha", "bisi bele bath" and "vada pav" are all en. A dish name is a
  loanword and cannot set lang by itself; someone typing only the name of a
  Maharashtrian dish in Latin letters has not written a sentence in Marathi.
- Only lang-bearing words that are NOT part of the dish name set lang. Compare:
  "puran poli" is en, "puran poli kashi karaychi" is mr, "misal pav kaise
  banate hain" is hi, "taal kivabe banabo" is bn. The dish name is identical in
  each pair; the words around it are the whole signal.
- A language or region named in the message is a word, not a signal:
  "bengali taal recipe", "marathi puran poli" and "west bengal style shukto"
  are English (lang "en"). The reader wrote the name in English.
- script is "native" if the user wrote in a non-Latin script, else "roman".
- register is "hinglish" for Latin-script Indian-language mixed with English,
  "roman" for a purely romanized single language, "native" for a native script.
- english feeds a dish-name search index, so return the DISH NAME the message
  is about, in English, not a translated sentence. "idli kaise banti hai" and
  "how is idli made" both become "idli". If several dishes are named, list them
  space-separated ("dosa idli"). If no dish is named (a general cooking
  question), return the key food nouns, or an empty string if there are none.
  Use the common romanized spelling, the one most people would type: "dosa"
  not "dhosa" or "dosai", "khichdi" not "khichri". Never replace a dish name
  with a description or a different dish: "taal" stays "taal", not "palm
  fruit" and not "dal". A dish you do not recognise is returned as typed
  (romanized if it arrived in native script).
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
      // Greedy decoding: the same dish name must map to the same English token
      // every time, or retrieval flakes on it. Detection/translation wants the
      // single most-likely answer, not a sample.
      temperature: 0,
      messages: [{ role: "user", content: trimmed }],
    });
    return parseNormalizeResponse(raw, trimmed);
  } catch {
    // Quota, network, refusal: retrieval must still run, so fall back rather
    // than throw into the request path.
    return enFallback(trimmed);
  }
}
