/**
 * One spelling for a dish name, applied at ingestion to tags/aliases and at
 * query time (Phase 4) to the reader's words — both sides of the match go
 * through this exact function, which is what makes the match deterministic.
 *
 * Unicode-aware on purpose: \p{L}/\p{N} keep Devanagari, Tamil, Bengali and
 * every other script the form accepts, and \p{M} keeps their vowel signs and
 * viramas. Only Latin diacritics (already split off by NFD) and punctuation
 * are folded, so "Vilepī" meets "vilepi" and "वडा पाव" survives.
 *
 * Format characters (\p{Cf}: ZWJ, ZWNJ, zero-width space, BOM, …) are dropped
 * first. They are invisible, so a reader never types them, but a pasted card
 * or a phone keyboard often carries them — and two spellings that look
 * identical on screen must normalise identical.
 *
 * The closing NFC is load-bearing: NFD splits two-part vowel signs (Tamil ொ,
 * Bengali ো, Kannada ೇ, …) and the reader's query arrives composed, so the
 * stored tag must be recomposed for exact-string equality to hold.
 */
export function normalizeDish(raw: string): string {
  return raw
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

/** The tag form of a dish name: normalised, spaces to hyphens. What Phase 4 matches on. */
export function dishTag(name: string): string {
  return normalizeDish(name).replace(/\s+/g, "-");
}

/**
 * Category words that name no dish. Phase 4 matches an alias anywhere inside
 * the reader's query, so an alias of "rice" would answer every corpus miss
 * with "rice" in it — "leftover rice ideas" included — with one family's
 * recipe. A submitter gets an alias by writing it in the story, and the model
 * is asked to list what readers might type, so this is checked in code rather
 * than left to the prompt. A floor, not a ceiling: the obvious staples in
 * English and the eight supported scripts.
 */
const GENERIC_WORDS = new Set(
  [
    "rice", "chawal", "chaval", "bhaat", "bhat", "dal", "daal", "dhal", "curry", "kari",
    "sabzi", "sabji", "subzi", "bhaji", "roti", "chapati", "bread", "chicken", "murgh",
    "mutton", "gosht", "fish", "machli", "egg", "anda", "paneer", "sweet", "mithai",
    "snack", "nashta", "dish", "recipe", "food", "khana", "masala", "gravy", "soup",
    "pickle", "achar", "chutney", "salad",
    "चावल", "भात", "दाल", "डाळ", "सब्जी", "भाजी", "रोटी", "पोळी", "चपाती", "चिकन", "मटन",
    "मछली", "अंडा", "पनीर", "मिठाई", "खाना", "नाश्ता",
    "ভাত", "ডাল", "তরকারি", "রুটি", "মাছ", "মাংস", "ডিম",
    "சாதம்", "பருப்பு", "கறி", "சிக்கன்", "மீன்", "முட்டை",
    "అన్నం", "పప్పు", "కూర", "రొట్టె", "చికెన్", "చేప",
    "ಅನ್ನ", "ಬೇಳೆ", "ರೊಟ್ಟಿ", "ಚಿಕನ್", "ಮೀನು",
    "ભાત", "દાળ", "શાક", "રોટલી",
  ].map(normalizeDish),
);

/**
 * One more fold, applied to BOTH sides at match time and nowhere else: a
 * trailing English plural `s` comes off each token.
 *
 * The gate asks whether the reader's words contain a stored name, so "brownie"
 * could never reach a row whose name is "brownies" — one letter, and the
 * recipe is unreachable. Folding both sides makes them the same string.
 *
 * Deliberately not inside `normalizeDish`: that function also builds the tag
 * that gets stored and shown, and a dish submitted as "Brownies" should still
 * be stored, listed and displayed as brownies. This is a matching detail, not
 * a naming one.
 *
 * Only Latin plurals, and only where dropping the letter is safe: a token of
 * three characters or fewer keeps its `s` ("bas" is not a plural of "ba"), and
 * so does one ending in "ss". Every Indian script is untouched — no Devanagari,
 * Tamil or Bengali token ends in an ASCII `s`.
 */
export function foldPlurals(normalized: string): string {
  return normalized
    .split(" ")
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .join(" ");
}

/** True when a normalised name is nothing but category words — "rice", "chicken curry". */
export function isGenericDish(normalized: string): boolean {
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => GENERIC_WORDS.has(t));
}
