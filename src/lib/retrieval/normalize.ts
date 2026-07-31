/**
 * Query normalisation. The job here is Hinglish: a user types "idly banane ka
 * tarika" or "इडली" or "Dhosa recipe" and all three have to land on the same
 * record. Two indexes do the work — an exact index over folded ASCII, and a
 * looser phonetic index that absorbs the spelling variance Roman-script Hindi
 * produces. The phonetic index is deliberately separate so it can be scored
 * lower; collapsing them would trade precision for recall, and a wrong ancestor
 * is worse than no ancestor.
 */

/** Words that carry no dish information. Mostly Hinglish request scaffolding. */
const STOPWORDS = new Set([
  // English
  "a", "an", "the", "of", "for", "and", "or", "to", "in", "with", "my", "me",
  "i", "is", "are", "what", "how", "make", "making", "cook", "cooking", "recipe",
  "recipes", "dish", "food", "eat", "eating", "please", "tell", "about", "was",
  "original", "ancient", "old", "history", "restore", "restoration", "show",
  // Hinglish
  "ka", "ki", "ke", "kaise", "kaisa", "banane", "banana", "banaye", "banate",
  "tarika", "vidhi", "banti", "bantha", "hai", "kya", "mujhe", "batao", "ko",
  "se", "par", "aur", "wala", "wali", "bata", "do", "dena",
  // Bare ingredients. These belong to the swap tool, not to dish retrieval —
  // and left in, "rice" resolves to whichever rice dish happens to score
  // highest, which is the nearest-neighbour failure in miniature.
  // `dal` is deliberately NOT here: the extraction gives Sūpa a record of its
  // own, so "dal" now names a dish rather than an ingredient.
  "rice", "chawal", "flour", "atta", "oil", "tel", "sugar",
  "cheeni", "salt", "namak", "wheat", "milk", "doodh", "water", "pani",
  "ghee", "curd", "dahi", "masala",
]);

/**
 * Strip Latin diacritics and punctuation, lowercase. Leaves Indic scripts
 * intact — note that `\p{M}` has to stay in the keep-set, because Devanagari
 * and Tamil vowel signs are spacing combining marks rather than letters, and
 * dropping them shatters "रोटी" into two one-character tokens that match
 * nothing.
 */
export function fold(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Latin combining marks: ā → a, ṛ → r, ś → s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapse the spelling variance of Roman-script Indian-language words.
 * idly/idli/iddli → idli. dhosa/dosai/dosa → dosa. khichri/khichdi → kicdi.
 * Lossy by design — only ever used as a secondary, lower-scored index.
 */
export function phoneticFold(token: string): string {
  let t = fold(token);
  if (!/^[a-z]+$/.test(t)) return t; // leave Devanagari and mixed tokens alone

  t = t
    .replace(/ph/g, "f")
    .replace(/([bcdgjkpt])h/g, "$1") // aspirated → unaspirated: dh→d, kh→k, th→t
    .replace(/sh/g, "s")
    .replace(/ck/g, "k")
    .replace(/z/g, "j")
    .replace(/v/g, "w")
    .replace(/(.)\1+/g, "$1") // doubled consonants: iddli → idli
    .replace(/[aeiou]+$/g, "") // trailing vowels: dosai → dos, idli → idl
    .replace(/aa|ee|oo|ai|ay|ei/g, (m) =>
      m === "aa" ? "a" : m === "ee" || m === "ai" || m === "ay" || m === "ei" ? "i" : "u",
    );

  return t;
}

export interface Tokenized {
  /** Content tokens, folded. Stopwords removed. */
  tokens: string[];
  /** The same tokens through the phonetic fold. Same length, same order. */
  phonetic: string[];
  /** Everything before stopword removal — used when a query is *all* stopwords. */
  raw: string[];
}

export function tokenize(input: string): Tokenized {
  const raw = fold(input).split(" ").filter(Boolean);
  // No fallback to `raw` when everything is a stopword. "recipe" and "kaise
  // banate hain" name no dish, and a query with nothing in it should retrieve
  // nothing rather than reach for the closest thing on the shelf.
  const tokens = raw.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  return { tokens, phonetic: tokens.map(phoneticFold), raw };
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}
