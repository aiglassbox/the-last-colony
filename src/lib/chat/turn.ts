/**
 * The turn vocabulary, shared by the chat route and the client.
 *
 * `TurnMode` is which component renders. `TurnKind` is why — and they are not
 * the same question, which is the mistake this file exists to correct.
 *
 * The route used to ship two booleans, `empty` and `modern`, and the card read
 * them as a two-bit code. That worked only as long as every miss meant the same
 * thing, and it does not: "we hold no record" is a fact about the corpus, while
 * "this dish is not Indian" is a fact about the dish. Collapsing them put a
 * "not in the restored corpus yet" note under a pizza, which promises a record
 * that will never exist because there was never anything to record.
 *
 * So the reason is named once, here, and every piece of copy downstream is a
 * lookup on it rather than an inference from flags.
 */

export type TurnMode = "restoration" | "conversation" | "indianize";

export type TurnKind =
  /** Indian, with an ancient original, and we hold the record. */
  | "record"
  /** Indian, but genuinely modern — no ancient original to find. */
  | "modern"
  /** Indian, likely had an older form, not documented by us yet. */
  | "gap"
  /** Not Indian in origin. Nothing to restore, and the corpus is not the point. */
  | "foreign";

/** Turns that carry a record, and so may show a badge and a source strip. */
export function hasRecord(kind: TurnKind): boolean {
  return kind === "record";
}

/** What the model declares on a corpus miss, before it is mapped to a turn. */
export type Resolved = "indianise" | "modern" | "restore" | "reply";

/** How a resolved turn renders, and the reason the card states for it. */
export const RESOLUTION: Record<Resolved, { mode: TurnMode; kind: TurnKind | null }> = {
  indianise: { mode: "indianize", kind: "foreign" },
  modern: { mode: "restoration", kind: "modern" },
  restore: { mode: "restoration", kind: "gap" },
  reply: { mode: "conversation", kind: null },
};

/** A card-shaped opening: the model went straight into the markers. */
const CARD_SHAPED = /§\s*(VERDICT|THEN|WHAT_CHANGED|RESTORE_TODAY|REBUILD|SWAPS|PLATE)\s*§/i;

/**
 * The mode the model declared on its first line.
 *
 * When it declared nothing, the fallback is prose, not a card. A card is the
 * expensive guess: it wraps whatever the model wrote in a provenance frame and
 * a reason the reader will take as fact, on a turn that may never have named a
 * dish. Only fall back to a card when the completion is visibly card-shaped,
 * and let everything else render as prose.
 *
 * Lives here rather than in the route so it can be exercised without a model
 * key and without a server: routing was the least tested thing in the product
 * and the source of most of its wrong answers.
 */
export function parseResolved(head: string): Resolved {
  const m = /MODE:\s*(INDIANISE|MODERN|RESTORE|REPLY)/i.exec(head);
  const word = m?.[1].toUpperCase();
  if (word === "INDIANISE") return "indianise";
  if (word === "MODERN") return "modern";
  if (word === "REPLY") return "reply";
  if (word === "RESTORE") return "restore";
  return CARD_SHAPED.test(head) ? "restore" : "reply";
}

/**
 * The kind of a stored message.
 *
 * Threads persist in localStorage, so messages written before `kind` existed
 * are still on readers' devices carrying `empty`/`modern` instead. They are
 * translated here rather than at each call site — and note the old shape could
 * not express `foreign` at all, which is precisely the bug: an Indianisation
 * turn was stored as "not empty", indistinguishable from a restoration.
 */
export function kindOf(message: {
  kind?: TurnKind;
  mode?: TurnMode;
  empty?: boolean;
  modern?: boolean;
}): TurnKind {
  if (message.kind) return message.kind;
  if (message.mode === "indianize") return "foreign";
  if (!message.empty) return "record";
  return message.modern ? "modern" : "gap";
}
