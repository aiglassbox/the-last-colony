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
  /** Composer placeholder once the command is in the box. */
  hint: string;
  /** Appended to the turn instruction. Narrows the answer; never widens it. */
  instruction: string;
  /**
   * Shown as a pill on the opening screen. The comp offers three; the fourth
   * stays typeable, and still carries its directive when used.
   */
  promoted: boolean;
}

export const COMMANDS: SlashCommand[] = [
  {
    slug: "recipe-card",
    label: "Generate Recipe Card",
    promoted: true,
    hint: "…and the dish to lay out as a card",
    instruction:
      "The reader asked for a recipe card. Make RESTORE_TODAY complete enough to " +
      "cook from unaided — quantities, order and timing — using only what the " +
      "record and the swap table give you. Where a quantity is not recorded, say " +
      "so rather than supplying one.",
  },
  {
    slug: "pre-raj",
    label: "Then vs Now",
    promoted: true,
    hint: "…and the dish to take back before 1858",
    instruction:
      "The reader asked specifically what this dish was before the colonial " +
      "period. Spend THEN and WHAT_CHANGED on that: what the older version was " +
      "made of, and which of those components the modern one lost.",
  },
  {
    slug: "healthier-swap",
    label: "Healthier Swap",
    promoted: true,
    hint: "…and the ingredient or dish to swap",
    instruction:
      "The reader asked for a substitution. Every swap must come from the swap " +
      "table above, quoted at the ratio it records. Do not offer nutritional or " +
      "medical claims for any of them — say what the swap changes about the dish, " +
      "not about the reader.",
  },
  {
    slug: "oil-match",
    label: "Oil Match",
    promoted: false,
    hint: "…and the dish to match a cooking fat to",
    instruction:
      "The reader asked which cooking fat suits this dish. Answer from the fat " +
      "the record names and from the swap table, and say plainly when neither " +
      "records one. No health claims.",
  },
];

/** The three the opening screen offers. */
export const PROMOTED_COMMANDS = COMMANDS.filter((c) => c.promoted);

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
