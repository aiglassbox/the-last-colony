/**
 * The Indian food word, restored to generated prose.
 *
 * The voice rule is that rawa is not semolina and haldi is not turmeric: the
 * Indian word is what the reader grew up hearing, and the English or scientific
 * one puts a stranger in the room. Told that, the model complied in the way that
 * costs it nothing and gives the reader nothing — it kept the English word as
 * the name and put the Indian one in brackets after it. A live fusion card
 * listed "whole wheat flour (atta)". That is the swap the rule exists to stop,
 * performed politely, and the bracket makes it look like a concession.
 *
 * So the gloss is collapsed here, the same way the em dash and the markdown
 * asterisk are removed: the rule is stated in the prompt and enforced in the
 * pipeline, because stating it has been tried.
 *
 * TWO SEPARATE JOBS, and the second is deliberately much smaller than the first.
 *
 * `collapseGloss` runs on any pairing in `GLOSS`, in either order, and always
 * keeps the Indian side. It is safe on everything because it only fires where
 * the model has already written both words, so no meaning is lost: the reader
 * who needed "atta" explained had it explained by the word standing next to it,
 * and the sentence still names the same flour.
 *
 * `restoreBareWord` replaces an English word standing alone, and its list is
 * short on purpose. Most English food words in this project are live retrieval
 * aliases — "semolina" is how a reader finds the rava swap, "lentil" is in the
 * dal record, "wheat flour" is the modern_item of swap-maida — and several of
 * them appear inside phrases where the Indian word does not fit: a record says
 * "the germ that the semolina mill removes", and "the rawa mill" is not a thing.
 * Rewriting a word the model quoted faithfully from a record is the failure this
 * file is supposed to prevent, not commit. So the bare list holds only words
 * that stand alone, name one thing, and form no compound worth protecting.
 *
 * Neither pass touches a record. Both run on model prose, after the punctuation
 * pass and before the reader sees it.
 */

/** English name to the Indian word, for the parenthetical form. */
const GLOSS: Array<[english: string, indian: string]> = [
  // "rava" and not "rawa": both spellings are current, and the corpus, the swap
  // id and the Then/Now diff all say rava. One spelling across the product
  // matters more than which of the two it is.
  ["semolina", "rava"],
  ["semolina", "sooji"],
  ["whole wheat flour", "atta"],
  ["wheat flour", "atta"],
  ["refined flour", "maida"],
  ["clarified butter", "ghee"],
  ["turmeric", "haldi"],
  ["lentils", "dal"],
  ["lentil", "dal"],
  ["split pulses", "dal"],
  ["gram flour", "besan"],
  ["chickpea flour", "besan"],
  ["rock salt", "sendha namak"],
  ["flattened rice", "poha"],
  ["cottage cheese", "paneer"],
  ["jaggery", "gur"],
  ["yoghurt", "curd"],
  ["yogurt", "curd"],
  ["fenugreek", "methi"],
  ["asafoetida", "hing"],
  ["cumin", "jeera"],
  ["coriander", "dhania"],
  ["cardamom", "elaichi"],
  ["clarified butter", "tup"],
];

/**
 * The bare swap. Every entry stands alone as a whole ingredient name, so there
 * is no compound for the replacement to break, and none of them is the searched
 * form of a record: a reader looking for the ghee swap types ghee.
 */
const BARE: Array<[english: RegExp, indian: string]> = [
  [/\bclarified butter\b/gi, "ghee"],
  [/\bturmeric powder\b/gi, "haldi"],
  [/\bturmeric\b/gi, "haldi"],
  [/\bcottage cheese\b/gi, "paneer"],
  [/\bgram flour\b/gi, "besan"],
  [/\bchickpea flour\b/gi, "besan"],
  [/\byoghurt\b/gi, "curd"],
  [/\byogurt\b/gi, "curd"],
  [/\basafoetida\b/gi, "hing"],
  // The spec's own headline example, and it turned up in prose on a live upma
  // card: "industrially milled wheat semolina from the north". It was held back
  // at first because a swap record said "the germ that the semolina mill
  // removes" and "the rava mill" is not a thing — the record has since been
  // rewritten, so there is no longer a faithful quotation for this to break.
  // The alias in swap-rava.json stays as it is: a reader searching "semolina"
  // must still find the swap, and this never runs on a query or on a record.
  [/\bwheat semolina\b/gi, "wheat rava"],
  [/\bsemolina\b/gi, "rava"],
  // The other spelling, which is not an English word being swapped back but the
  // right word spelt the other way. Both are current and the prompt asks for
  // this one, so the model arrives with it from its own knowledge as well. It
  // is normalised for the same reason the rest of this file exists: the table
  // and the Then/Now diff beneath the prose render "rava" from the record, and
  // a card that says rawa above rava has spelt one ingredient two ways where
  // the reader can see both at once.
  [/\brawa\b/gi, "rava"],
  // Ordered before the bare "flour" forms so the qualifier decides the word.
  // "refined wheat flour" is maida and "whole wheat flour" is atta, and a
  // single rule mapping "wheat flour" to atta would have turned the first into
  // "refined atta", which names the wrong flour.
  [/\brefined wheat flour\b/gi, "maida"],
  [/\bwhole[- ]?wheat flour\b/gi, "atta"],
  [/\bwholewheat flour\b/gi, "atta"],
];

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `english (indian)` and `indian (english)` both become the Indian word.
 *
 * The brackets may hold a little more than the bare word — "atta flour",
 * "sooji or rawa" — so the inside is matched loosely and only has to contain
 * the paired term. Anything else in brackets is left exactly as written.
 */
const GLOSSED: Array<[RegExp, string]> = GLOSS.flatMap(([english, indian]) => {
  const e = escape(english);
  const i = escape(indian);
  return [
    // english (indian)  ->  indian
    [new RegExp(`\\b${e}\\s*\\(\\s*[^()]*\\b${i}\\b[^()]*\\)`, "gi"), indian],
    // indian (english)  ->  indian
    [new RegExp(`\\b${i}\\s*\\(\\s*[^()]*\\b${e}\\b[^()]*\\)`, "gi"), indian],
  ] as Array<[RegExp, string]>;
});

export function collapseGloss(text: string): string {
  let out = text;
  for (const [pattern, indian] of GLOSSED) out = out.replace(pattern, indian);
  return out;
}

export function restoreBareWord(text: string): string {
  let out = text;
  for (const [pattern, indian] of BARE) out = out.replace(pattern, indian);
  return out;
}

/**
 * Both passes, in the order that matters: the gloss goes first, so that
 * "clarified butter (ghee)" collapses to "ghee" rather than being rewritten
 * into "ghee (ghee)" and then collapsed by luck.
 */
export function restoreIndianWords(text: string): string {
  return restoreBareWord(collapseGloss(text));
}
