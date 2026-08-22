/**
 * The language vocabulary for the multilingual pipeline.
 *
 * Urdu is intentionally absent from the active set: it is right-to-left and
 * needs layout work this feature does not cover, so it is detected upstream and
 * routed to the English fallback rather than authored in-language. See
 * `.docs/plans/2026-08-22-multilingual-accessibility.md`.
 */

/** ISO 639-1 codes for the eight active languages. */
export const SUPPORTED_LANGS = [
  "en", // English
  "hi", // Hindi
  "bn", // Bengali
  "mr", // Marathi
  "te", // Telugu
  "ta", // Tamil
  "gu", // Gujarati
  "kn", // Kannada
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/** Human-readable names, for the confidence-fallback message. */
export const LANG_NAMES: Record<SupportedLang, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  mr: "Marathi",
  te: "Telugu",
  ta: "Tamil",
  gu: "Gujarati",
  kn: "Kannada",
};

export function isSupported(code: string): code is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(code);
}

/**
 * What the query was, once detection and translation have run.
 *
 * `english` is what retrieval sees; `lang`/`register` are what the reply is
 * authored in. On low confidence or an unsupported language, `lang` is "en" and
 * `english` is the original string unchanged.
 */
export interface Normalized {
  lang: SupportedLang;
  /** The writing system the user used. */
  script: "native" | "roman";
  /** The exact register to mirror back. */
  register: "native" | "hinglish" | "roman";
  /** 0..1. Below the threshold the result is forced to the English fallback. */
  confidence: number;
  /** The query translated to English for retrieval. */
  english: string;
  /** True when detection was too weak or the language is unsupported. */
  fell_back: boolean;
}

/** The safe result: reply in English, retrieve on the untranslated string. */
export function enFallback(original: string): Normalized {
  return {
    lang: "en",
    script: "roman",
    register: "roman",
    confidence: 1,
    english: original,
    fell_back: true,
  };
}
