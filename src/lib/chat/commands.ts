/**
 * Slash commands.
 *
 * The quick actions are not buttons that do things — they are prompt openers.
 * Selecting one writes `/oil-match ` into the composer and hands the caret
 * back; the reader finishes the sentence and sends it like any other message.
 *
 * That means a command never bypasses retrieval or the turn-mode decision. It
 * only adds a directive to the turn, so `/healthier-swap palak paneer` still
 * goes through the same corpus gates as `palak paneer` typed plain — and a
 * reader who types the command by hand gets the same result as one who tapped
 * the pill.
 *
 * Shared by the composer and the route, so the vocabulary cannot drift.
 */

export interface SlashCommand {
  /** Without the leading slash. */
  slug: string;
  label: string;
  /** Label for the thread title, where the dish is already the subject. */
  short: string;
  /** Composer placeholder once the command is in the box. */
  hint: string;
  /**
   * Sent as prose when the command arrives with no dish behind it. The command
   * alone is not a turn to answer, and the answer must not be a card — see the
   * empty-query branch in the chat route.
   */
  ask: string;
  /** Appended to the turn instruction. Narrows the answer; never widens it. */
  instruction: string;
}

export const COMMANDS: SlashCommand[] = [
  {
    slug: "recipe-card",
    label: "Generate Recipe Card",
    short: "Recipe Card",
    hint: "…and the dish to lay out as a card",
    ask: "Name a dish after the command and I will lay it out as a recipe card.",
    instruction:
      "The reader asked for a recipe card. Make RESTORE_TODAY complete enough to " +
      "cook from unaided — quantities, order and timing — using only what the " +
      "record and the swap table give you. Where a quantity is not recorded, say " +
      "so rather than supplying one.",
  },
  {
    slug: "pre-raj",
    label: "Pre-Raj Version",
    short: "Pre-Raj",
    hint: "…and the dish to take back before 1858",
    ask: "Name a dish after the command and I will take it back before 1858.",
    instruction:
      "The reader asked specifically what this dish was before the colonial " +
      "period. Spend THEN and WHAT_CHANGED on that: what the older version was " +
      "made of, and which of those components the modern one lost.",
  },
  {
    slug: "healthier-swap",
    label: "Healthier Swap",
    short: "Swap",
    hint: "…and the ingredient or dish to swap",
    ask: "Name the ingredient or dish you want swapped, after the command.",
    instruction:
      "The reader asked for a substitution. Every swap must come from the swap " +
      "table above, quoted at the ratio it records. Do not offer nutritional or " +
      "medical claims for any of them — say what the swap changes about the dish, " +
      "not about the reader.",
  },
  {
    slug: "oil-match",
    label: "Oil Match",
    short: "Oil Match",
    hint: "…and the dish to match a cooking fat to",
    ask: "Name a dish after the command and I will match a cooking fat to it.",
    instruction:
      "The reader asked which cooking fat suits this dish. Answer from the fat " +
      "the record names and from the swap table, and say plainly when neither " +
      "records one. No health claims.",
  },
];

const BY_SLUG = new Map(COMMANDS.map((c) => [c.slug, c]));

export interface ParsedCommand {
  command: SlashCommand | null;
  /** Everything after the command — the query retrieval actually sees. */
  rest: string;
}

/**
 * An unrecognised `/word` is left alone rather than stripped: a dish is more
 * likely than a typo'd command, and swallowing it would lose the query.
 */
export function parseCommand(text: string): ParsedCommand {
  const match = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return { command: null, rest: text.trim() };

  const command = BY_SLUG.get(match[1].toLowerCase());
  if (!command) return { command: null, rest: text.trim() };

  return { command, rest: (match[2] ?? "").trim() };
}

/**
 * Swap whichever command is already in the box for this one, keeping what the
 * reader has typed. Selecting a second pill should change the intent, not
 * stack two slashes.
 */
export function applyCommand(current: string, command: SlashCommand): string {
  const { rest } = parseCommand(current);
  return rest ? `/${command.slug} ${rest}` : `/${command.slug} `;
}
