import { LANG_NAMES, SUPPORTED_LANGS, type Normalized } from "./types";

/**
 * The last instruction before the model writes, telling it which language and
 * register to author the card in. Appended to the user turn the same way
 * PLAIN_WORDS is, so it wins over the contract when they disagree.
 *
 * On a fallback it does the TASK.md-required thing: reply in English and name
 * the languages we do support, in one line.
 */
export function replyInstruction(n: Normalized): string {
  if (n.fell_back || n.lang === "en") {
    const names = SUPPORTED_LANGS.filter((c) => c !== "en").map((c) => LANG_NAMES[c]);
    return (
      "\n\nReply in English. If the reader wrote in a language you could not " +
      "place, add one short line naming the languages you can answer in: " +
      names.join(", ") +
      ". Do not apologise; just offer them."
    );
  }

  const name = LANG_NAMES[n.lang];
  const scriptRule =
    n.register === "hinglish"
      ? `Write in Hinglish: ${name} in Latin letters, mixed with English exactly as the reader did. Do not switch to native script.`
      : n.register === "roman"
        ? `Write in romanized ${name} (Latin letters), the way the reader typed it. Do not switch to native script.`
        : `Write in ${name} in its native script.`;

  return (
    `\n\nReply entirely in ${name}. ${scriptRule} Keep dish names and the names ` +
    `of any texts exactly as they are, untranslated. Every other rule you were ` +
    `given holds in ${name}: no health claims, no em dash, comparative nutrition ` +
    `on a named axis only, and no grading of how certain a record is.`
  );
}
