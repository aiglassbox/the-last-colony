/**
 * A conversation turn talking about itself instead of answering.
 *
 * The brief bans opening on a greeting or a compliment, and the conversation
 * rules ban both of the moves below, because a reader who has just pointed out
 * a fault wants the fault fixed, not agreed with and not read back to them. The
 * model does them anyway. Told the fusion card had lost its pizza half, it
 * opened "You are right." and spent a sentence on nothing; told not to, it
 * opened "The previous suggestion focused on the pasta component", which is the
 * card restated in the past tense and was the example the rule itself used.
 * Stating it twice did not hold, so this removes it, the same way em dashes and
 * markdown are removed.
 *
 * Two rewrites, because the move has two positions. `stripOpener` runs once, on
 * the front of the turn, where a concession can only ever be. `dropNarration`
 * runs on every chunk, because the sentence that describes the last answer
 * moved to second place the moment the first was closed off, and second place
 * is not a special case: it is wherever the sentence happens to land.
 *
 * Both work on whole sentences, which the caller already guarantees — the pump
 * cuts at sentence boundaries so a health claim can be judged, and the same cut
 * serves here. Neither ever empties a turn: a reply that is nothing but
 * throat-clearing is a bad answer, and no answer is worse.
 */

/** The agreements themselves, shared by the two shapes one can arrive in. */
const AGREEMENT =
  "(?:you(?:'re|\\s+are)\\s+(?:right|correct)|good\\s+(?:catch|point)|fair\\s+(?:point|enough)|absolutely|exactly|indeed|noted|agreed|apologies|my\\s+apologies|i\\s+(?:see|take)\\s+your\\s+point|i\\s+see\\s+what\\s+you\\s+mean|that(?:'s|\\s+is)\\s+(?:right|correct|fair))";

/**
 * A concession standing as its own sentence, plus the short tail one can carry
 * before it stops being a bare concession. Twelve characters is the width of
 * "about that".
 */
const CONCESSION = new RegExp(`^(?:\\s*${AGREEMENT}[^.!?\\n]{0,12}[.!?]["')\\]]*\\s*)+`, "i");

/**
 * The same move with a comma instead of a full stop: "You are right, it needs
 * the pizza half back." Here the answer is inside the sentence, so the clause
 * comes off and the sentence stays. Anything joined by "that" is left whole,
 * since "you are right that the tamarind is doing the work" has no sentence
 * left once the clause goes.
 */
const CONCESSION_CLAUSE = new RegExp(`^\\s*${AGREEMENT}\\s*,\\s*(?=\\S)`, "i");

/**
 * A sentence describing the previous turn rather than answering: the card read
 * back, or the reader's own request read back to them. Three ways in, all of
 * them naming the exchange instead of the food.
 *
 * The nouns are deliberately the ones that can only mean a turn. "Dish",
 * "recipe" and the word "original" are left out, because this product says "the
 * original dish used hand-pounded rice" in earnest and that sentence is the
 * whole point of it.
 */
const NARRATION = new RegExp(
  "^(?:" +
    // "The previous suggestion focused on the pasta component."
    "(?:the|my|that|this)\\s+(?:previous|last|earlier|prior|initial|first)\\s+" +
    "(?:suggestion|answer|reply|response|version|card|note|point)" +
    // "Your last request was for a fusion of pizza and pasta."
    "|(?:your|the)\\s+(?:previous|last|earlier|original|initial)\\s+" +
    "(?:request|question|message|ask|prompt)" +
    // "I suggested millet noodles."
    "|i\\s+(?:previously\\s+|earlier\\s+|first\\s+)?" +
    "(?:suggested|said|mentioned|proposed|offered|focused|gave|described|wrote)" +
    ")\\b",
  "i",
);

/** Same sentence, matched where it opens a turn and takes its trailing space. */
const SELF_NARRATION = new RegExp(
  NARRATION.source.replace(/^\^/, "^\\s*") + "[^.!?\\n]*[.!?][\"')\\]]*\\s*",
  "i",
);

/**
 * Where a narration sentence hands over to the half that answers. "Your last
 * request was for a fusion, so we should move to a layered bake" is a sentence
 * with the answer bolted to the back of it; dropping the whole thing would take
 * the bake with it, so the pivot is the seam to cut on.
 */
const PIVOT = /,?\s+\b(?:so|but|and so|which is why|therefore|because|instead)\b\s+(?=\S)/i;

/**
 * The book introducing itself as a person.
 *
 * KrantiCookBook is the cookbook, not somebody who cooks: no age, no gender, no
 * family role. The prompt says so at the top of the voice section, and the
 * failure it guards against is specific and well known in this product's
 * register — the warm Indian-food voice slides into a maternal one almost by
 * gravity, and "like a mother, I would tell you to let it rest" is the shape it
 * arrives in.
 *
 * Only SELF-reference. The reader's own grandmother is theirs to raise and the
 * cookbook is free to talk about her, so nothing here matches a third person:
 * "the way your daadi made it" is warmth and stays. What goes is the sentence
 * where the speaker claims the role.
 *
 * The whole sentence goes rather than the phrase. Cutting "like a mother" from
 * the front leaves an instruction that reads fine, but cutting "I am the voice
 * of every grandmother" leaves nothing, and the two cannot be told apart by a
 * rule short enough to trust. A sentence that exists to say who is speaking is
 * not carrying a recipe.
 */
const PERSON = String.raw`(?:mother|mothers|maa|amma|ammi|mummy|grandmother|grandmothers|grandma|daadi|dadi|nani|aunt|aunty|aunties|chachi|bua|didi|elder|elders|woman|women|man|men|lady|wife|housewife|homemaker|cook|chef|historian|grandparent|parent|nani\s+maa)`;

const SELF_AS_PERSON = new RegExp(
  "(?:" +
    // "I am your grandmother." · "I'm a food historian." · "I am like a mother."
    String.raw`\bi\s*(?:'m|\s+am|\s+was)\s+(?:not\s+)?(?:like\s+)?(?:a|an|the|your|every|any|some)?\s*(?:\w+\s+){0,2}?${PERSON}\b` +
    // "like a mother, I would..." · "as your daadi would say, ..."
    String.raw`|\b(?:like|as)\s+(?:a|an|the|your|every)\s+(?:\w+\s+){0,2}?${PERSON}\b[^.!?\n]*\bi\b` +
    // "speaking as a grandmother" · "the voice of every mother"
    String.raw`|\bspeaking\s+as\s+(?:a|an|the|your)\s+(?:\w+\s+){0,2}?${PERSON}\b` +
    String.raw`|\b(?:i\s+am|i'm)\s+the\s+voice\s+of\b` +
    ")",
  "i",
);

/**
 * Drop every sentence in which the book claims to be a person.
 *
 * Same shape as `dropNarration`: pieces are matched and rejoined verbatim, and
 * a cut that would empty the turn is abandoned, because a reply that only
 * introduces its speaker is a bad answer and no reply is worse.
 */
export function dropSelfAsPerson(text: string): string {
  const pieces = text.match(/[^.!?]+(?:[.!?]+["')\]]*)?\s*/g);
  if (!pieces) return text;

  let cut = false;
  const kept = pieces.map((piece) => {
    if (!SELF_AS_PERSON.test(piece)) return piece;
    cut = true;
    return "";
  });

  if (!cut) return text;
  const out = kept.join("");
  return out.trim() ? out : text;
}

/**
 * Drop the leading throat-clearing, unless it is the whole reply.
 *
 * A turn that is nothing but "You are right." is left alone: it is a bad
 * answer, but an empty one is worse, and the fallback that catches an empty
 * completion would re-declare the turn on the reader's screen.
 */
export function stripOpener(text: string): string {
  let out = text;
  // Twice over, in either order: "You are right. The previous answer focused on
  // the pasta." is both moves in one breath, and cutting one leaves the other
  // standing where the answer should be.
  for (let pass = 0; pass < 2; pass++) {
    for (const pattern of [CONCESSION, SELF_NARRATION]) {
      const match = pattern.exec(out);
      if (!match) continue;
      const rest = out.slice(match[0].length);
      if (rest.trim()) out = rest;
    }

    const clause = CONCESSION_CLAUSE.exec(out);
    if (clause) {
      // The sentence carries on, so it needs its capital back.
      const rest = out.slice(clause[0].length);
      if (rest.trim()) out = rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  return out;
}

/**
 * Drop every sentence that narrates the exchange, wherever it sits.
 *
 * Sentences are matched, not split on: the pieces are rejoined verbatim, so a
 * decimal point mistaken for a full stop costs nothing. Only a piece that opens
 * on a narration is touched, and a mis-cut fragment never does.
 *
 * A narration carrying the answer in a trailing clause is cut at the pivot
 * rather than deleted, so "your last request was for a fusion, so we should
 * move to a layered bake" keeps the bake. Everything else goes whole, and if
 * that would leave nothing, the text is returned untouched.
 */
export function dropNarration(text: string): string {
  const pieces = text.match(/[^.!?]+(?:[.!?]+["')\]]*)?\s*/g);
  if (!pieces) return text;

  let cut = false;
  const kept = pieces.map((piece) => {
    if (!NARRATION.test(piece.trimStart())) return piece;
    cut = true;

    const pivot = PIVOT.exec(piece);
    if (!pivot) return "";
    const rest = piece.slice(pivot.index + pivot[0].length);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  });

  if (!cut) return text;
  const out = kept.join("");
  return out.trim() ? out : text;
}
